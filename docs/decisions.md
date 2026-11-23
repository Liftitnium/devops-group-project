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

**Status:** accepted (2026-11-20)

**Context.** `main` must always be deployable, and every merge must reach Azure without
anyone running commands by hand. A deploy only counts if the new version really answers.
The pipeline also needs a way to sign in to Azure: the IE directory does not let students
register applications, so we cannot create a service principal with a client secret.

**Decision.**

- *One workflow* (`.github/workflows/pipeline.yml`). Every pull request and push runs CI:
  ruff, tests against a throwaway SQL Server with a 70% coverage floor, `pip-audit`, a
  gitleaks scan of the whole history, and an image build. A final `ci` job is the one
  check the `main` ruleset requires; it fails if any job before it did not succeed.
- *Continuous deployment on `main` only*, after `ci` passed: images pushed to GHCR tagged
  with the commit SHA, `az containerapp update` for both services, `ui/config.js` written
  with the Azure URLs and the UI uploaded to the Static Web App.
- *Verified deploys.* The run polls `/health` until it reports the new SHA (5 minutes, to
  survive scale from zero and a paused database), then `scripts/smoke_test.sh` creates an
  exercise and a workout on the live API, asks progress for the next session, and deletes
  them again. Either failing fails the run.
- *Sign-in without a stored secret.* The deploy job signs in with OIDC as the managed
  identity `sdd-3b-g6-github`, which the professor provides with access to our resource
  group only. Its federated credential must trust tokens for this repository's
  `production` environment
  (`repo:Liftitnium/devops-group-project:environment:production`). If
  `AZURE_CLIENT_ID` is not set, the job falls back to a service principal in the
  `AZURE_CREDENTIALS` secret.
- *Infrastructure apart from releases.* `infra/main.bicep` declares every resource and is
  applied by `infra/setup.sh`, run by a member. The pipeline only changes images. The
  script also creates the services' database users (ADR-7), which needs the SQL admin
  password; keeping it out of GitHub means one secret fewer to leak.

**Alternatives.**

- Separate CI and CD workflows chained with `workflow_run`: harder to read, and harder to
  guarantee CD runs on exactly the commit CI tested.
- Run Bicep on every deploy: slower, and the SQL admin password would have to be a GitHub
  secret.
- A service principal with a client secret: not allowed in the IE directory, and the
  secret would have to be stored and rotated.
- An Azure CLI script instead of Bicep: works, but it is not declarative and not credited.
- Health check only: a service can answer `/health` while its main endpoints are broken,
  for example after a bad migration or a wrong `WORKOUTS_URL`.

**Consequences.**

- A red CI never deploys, and a deploy that does not come up healthy and pass the smoke
  test fails visibly in the run.
- The smoke test writes to the live database for a few seconds and cleans up after itself,
  also when it fails.
- Infrastructure changes are rare and need `setup.sh`. Nobody changes resources in the
  portal, because Bicep would undo the change on the next run.
- While the managed identity is not ready, the latest `main` is deployed by hand with the
  same steps (image update, UI upload, health check, smoke test), first on 20 Nov.

## ADR-4: Monitoring

**Status:** accepted (2026-11-20)

**Context.** The brief asks for request logs, a dashboard with request count, error rate
and response time, and one measured SLO, all in Log Analytics (§6–7). Application
Insights is not allowed, the workspace is free up to 5 GB a month, and the team has to show
the dashboard and the SLO at the Sprint Review.

**Decision.**

- *Logs.* Each service writes one JSON line per request to stdout: `method`, `path`,
  `status`, `duration_ms`, `service`, at INFO level, with no request or response bodies.
  Container Apps sends stdout to the workspace `<prefix>-logs`, table
  `ContainerAppConsoleLogs_CL`, where `parse_json(Log_s)` turns each line back into
  fields. The workspace keeps 30 days and has a 0.5 GB daily cap.
- *Dashboard as saved queries.* `monitoring/queries.kql` holds every query, and
  `infra/main.bicep` turns each section of it into a saved query in the workspace
  (category `LiftLog`): request count, error rate and response time per service, the two
  SLO queries, the slowest endpoints and recent errors. `/health` is excluded from all of
  them, because it is the pipeline's probe, not user traffic.
- *SLO.* 99% of GET requests to the workouts API are answered without a server error in
  under 500 ms, over a rolling 7 days. Workouts is the service every screen reads from, so
  it is what users wait on. One query gives the SLI, whether the target is met and the
  error budget left; a second shows the SLI per day.

**Alternatives.**

- Application Insights: not allowed by the brief, and a second place to look.
- A Workbook or a shared portal dashboard: one more resource type, stored as large JSON
  that is hard to review in a pull request, or made by hand in the portal and lost when the
  resources are recreated.
- Plain-text logs: every query would need regex parsing.
- An alert rule on the SLO: not required, and with a few hundred requests a week one cold
  start moves the SLI by several points, so it would mostly raise false alarms.

**Consequences.**

- The queries are reviewed in pull requests like code. Changing one means editing the
  `.kql` file and re-running `infra/setup.sh`.
- Cold starts (a Container App scaling up from zero, a database waking from auto-pause)
  count against the SLO on purpose, because users feel them. With little traffic they are
  the main way the SLO is missed, which is the trade-off of ADR-2's serverless database.
- Paths contain ids (`/exercises/3`), so queries that group by endpoint fold them into
  `/exercises/{id}`.
- If the services start logging more, the daily cap stops ingestion for the rest of the
  day instead of costing money.

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
