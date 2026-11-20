# Decision records

Short records of the choices that shaped LiftLog. Each one: context, decision,
alternatives, consequences. **Drafts below are from the skeleton; the team reviews and
edits them before the submission tag.**

## ADR-1: Two services split by write path vs. analysis

**Context.** The brief requires exactly two services, each with its own database, talking
over HTTP. LiftLog does two different jobs: recording sets during a workout, and
analysing history afterwards (PRs, goals, next-session weight).

**Decision.** `workouts` owns exercises, workouts and sets. `progress` owns goals, detected
PRs and recommendations, and reads history from `workouts` over HTTP. Inside each
service: a small layered structure (router → service → repository), with the HTTP call
to workouts behind a `WorkoutsGateway` protocol in progress.

**Alternatives.** Split by entity (exercises service vs. workouts service): the two would
need each other on every request. One service plus a background worker: forbidden (third
container) and not two services.

**Consequences.** Logging stays available when analysis is down, which is the partial
failure story. Progress depends on workouts and must handle its timeouts. Progress may
cache computed results in its own database, so a recommendation can be stale until
recomputed.

## ADR-2: Storage

**Context.** Fixed by the brief: Azure SQL serverless in Azure, SQL Server in compose.

**Decision.** One database per service, schema built by numbered `.sql` migration files
applied on startup (`app/db.py:migrate`), driver `pymssql`, plain SQL in repositories.

**Alternatives.** SQLAlchemy + Alembic: more abstraction than two small schemas need, and
a second way to define the schema. pyodbc: needs the Microsoft ODBC driver in the image.

**Consequences.** Migrations are plain SQL anyone can read. Applied files are never edited.
Azure SQL auto-pause makes the first request after an hour slow (up to ~1 minute), so
startup retries the connection with backoff.

## ADR-3: Deployment and pipeline

**Context.** Main must stay deployable; deployment must be automatic and verified.

**Decision.** One GitHub Actions workflow. CI on every PR/push. On main: images to GHCR
tagged by commit SHA, `az containerapp update`, Static Web App upload, then `/health`
polled until it reports the new SHA. Infrastructure is Bicep (`infra/`), applied by
`infra/setup.sh`.

**Alternatives.** Separate CI and CD workflows chained with `workflow_run`: harder to read
and to guarantee CD ran on exactly the commit CI tested. Azure CLI script instead of Bicep:
works, but not declarative and not credited.

**Consequences.** A red CI never deploys. A deploy that does not come up healthy fails the
run visibly. Re-running Bicep keeps the images currently deployed.

## ADR-4: Monitoring

**Context.** Logs must be queryable in Log Analytics at low volume and cost.

**Decision.** One JSON line per request on stdout (`method`, `path`, `status`,
`duration_ms`, `service`), INFO level, no bodies. Queries in `monitoring/queries.kql`.
Workspace daily cap 0.5 GB.

**Alternatives.** Application Insights: another Azure service, not allowed. Plain-text
logs: need regex parsing in every query.

**Consequences.** Dashboard and SLO queries are simple `parse_json` + `summarize`.

## ADR-5: Next-session recommendation by double progression

**Status:** accepted (2026-11-18)

**Context.** Our feature beyond CRUD tells a lifter what to do next session for an exercise.
It has to be explainable in one sentence, testable without a database, and work from data
we already log (weight and reps per set, a rep range per exercise).

**Decision.** Use double progression on the working sets (the heaviest weight) of the last
session. If every working set reached the top of the rep range, add 2.5 kg (upper body) or
5 kg (lower body) and aim for the bottom of the range. If every working set fell below the
range, drop about 10%, rounded down to 2.5 kg. Otherwise keep the weight and aim for one more
rep than the weakest set. The rule is a pure function in `services/progress/app/coach.py`;
the endpoint only fetches history and formats the answer. Nothing is stored, so a
recommendation is always consistent with the latest history.

**Alternatives.** Percentages of an estimated one-rep max (rejected by the team: estimates
are noisy at higher reps and need a formula users can't check). RPE-based autoregulation
(needs the user to log effort per set, more input than an MVP should ask for). A trained
model (no data to train it on).

**Consequences.** Depends on the workouts history endpoint (`docs/api.md`); when workouts
is down the coach answers 503 with a readable message and logging keeps working. Increments
are fixed per body part, so very light or very heavy exercises progress less precisely.

## ADR-6: _optional, e.g. frontend choice or authentication_

## ADR-7: Database access in Azure

**Status:** accepted (2026-11-19)

**Context.** Both services reach their Azure SQL database over the network. Two questions:
which identity each service connects as, and which networks may reach the SQL server.
Until 19 Nov both services connected as the server administrator, so one compromised
service could read, change or drop both databases.

**Decision.**

- *Identity:* each service connects as its own contained database user (`workouts_app`,
  `progress_app`), which exists only in that service's database and is `db_owner` there so
  it can run its own migrations. `infra/setup.sh` creates the users with
  `infra/sql/app-user.sql`; the admin password is used only by that script, never by an app.
  This matches `docker compose`, where each service also has its own login.
- *Network:* the SQL server keeps public network access with one firewall rule, Azure's
  "Allow Azure services" (`0.0.0.0`). `setup.sh` adds a rule for the operator's own IP only
  while it creates the users and removes it on exit. TLS 1.2 is the minimum.

**Alternatives.** Private endpoint plus VNet-integrated Container Apps environment: the SQL
server would not be reachable from the internet at all, but it needs a VNet, a private DNS
zone and a workload-profile environment, which are outside the resource list the brief
allows and add cost. Microsoft Entra authentication with managed identities: no SQL
passwords at all, but it needs an Entra admin on the server and the IE directory does not
let students register applications or assign directory roles.

**Consequences.** A leaked service password exposes one database, not both, and cannot be
used to create logins or touch the other database. "Allow Azure services" admits any Azure
resource, including other customers' resources, to attempt a login; that risk is carried
by the passwords, which are long, random and stored only in `.env` and Container App
secrets. If the project outlived the course, the private endpoint is the first change to
make.

## ADR-8: No user accounts in the API

**Status:** accepted (2026-11-19)

**Context.** LiftLog is a single-user demo: one lifter, one set of workouts. The brief asks
for two services, a UI and a pipeline; it does not ask for sign-in. Both APIs are public
HTTPS endpoints so the Static Web App can call them from the browser.

**Decision.** The APIs have no authentication. CORS allows only the UI's origin, so other
websites cannot call the API from a visitor's browser. The OpenAPI page (`/docs`,
`/openapi.json`) stays public because the API documentation and the demo use it.

**Alternatives.** Entra ID (Easy Auth on the Container Apps and the Static Web App): real
sign-in with no code, but every member and the professor would need an account set up for
the demo, and the IE directory does not let us register the application. An API key in the
UI: anyone can read it from the page source, so it protects nothing.

**Consequences.** Anyone who knows a service URL can read, create, change and delete
workouts with a tool such as curl; CORS only stops browsers. This is acceptable because the
data is test data with no personal information, and we say so in the demo. Adding users
later means a `user_id` column on exercises and workouts, Easy Auth in front of both
services, and the workouts service passing the user on to progress.
