# LiftLog

Log your lifts and get told what to lift next time. LiftLog stores your workouts
(exercises, sets, weight, reps), detects personal records automatically, tracks goals,
and recommends the next session's weight with a progressive-overload rule.

**Live:** _UI URL goes here after the first deploy_ · **Status:** Sprint 1, skeleton

## Architecture

```mermaid
flowchart LR
    B[Browser] -->|static files| UI["Static Web App<br/>sdd-&lt;class&gt;-g6-ui"]
    B -->|HTTPS + CORS| W["workouts service<br/>Container App"]
    B -->|HTTPS + CORS| P["progress service<br/>Container App"]
    P -->|HTTP, 3 s timeout| W
    W --> WDB[("Azure SQL serverless<br/>sdd-&lt;class&gt;-g6-workouts-db")]
    P --> PDB[("Azure SQL serverless<br/>sdd-&lt;class&gt;-g6-progress-db")]
    W -. stdout JSON logs .-> LA["Log Analytics<br/>sdd-&lt;class&gt;-g6-logs"]
    P -. stdout JSON logs .-> LA
```

- **workouts** (`services/workouts`): exercises, workouts and sets. Source of truth for what you lifted.
- **progress** (`services/progress`): goals, personal records and next-session recommendations.
  Reads workout history from workouts over HTTP. If workouts is down, progress answers
  503 with a readable message instead of hanging.
- **ui** (`ui/`): plain HTML/JS, calls both services from the browser.

Why two services and why this shape: [docs/decisions.md](docs/decisions.md).

## Run locally

Needs Docker. From a clean clone:

```bash
cp .env.example .env    # then fill in the three passwords
docker compose up --build
```

UI http://localhost:8080 · workouts http://localhost:8001/docs · progress http://localhost:8002/docs

Partial failure: `docker compose stop workouts`, and progress keeps answering.

## Run the tests

Tests run against a real SQL Server (the one in compose). Per service:

```bash
docker compose up -d sqlserver
cd services/workouts            # or services/progress
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
TEST_DATABASE_URL="mssql://sa:<SA_PASSWORD>@localhost:1433/liftlog_test_workouts" python -m pytest
ruff check . && ruff format --check .
```

Coverage must stay at or above 70% (set in each `pyproject.toml`; CI fails below it).

## Pipeline

`.github/workflows/pipeline.yml`:

- **Every PR and push:** ruff lint + format check, tests with coverage against a throwaway
  SQL Server, `pip-audit`, a gitleaks scan of the whole history, and an image build.
- **Merge to main:** the same, then images pushed to GHCR tagged with the commit SHA,
  both Container Apps updated, the UI deployed to Static Web Apps, and `/health` polled
  until it reports the new SHA (fails the run after 5 minutes). Then
  `scripts/smoke_test.sh` creates an exercise and a workout on the live API, asks progress
  for the next session (so the call between the services is tested too), and deletes
  them again; any wrong answer fails the run. It also runs against `docker compose`:
  `WORKOUTS_URL=http://localhost:8001 PROGRESS_URL=http://localhost:8002 scripts/smoke_test.sh`.

## Reproduce the Azure setup

Everything is in `infra/main.bicep`. One member, logged in with `az login`:

```bash
CLASS=<class> SQL_ADMIN_PASSWORD='<strong password>' \
  WORKOUTS_DB_PASSWORD='<strong password>' PROGRESS_DB_PASSWORD='<strong password>' \
  IMAGE_TAG=<sha on GHCR> infra/setup.sh
```

The script deploys the Bicep and creates one database user per service
(`infra/sql/app-user.sql`); the services never connect as the SQL admin. It needs `sqlcmd`
or Docker, and briefly allows your own IP on the SQL firewall (removed when it ends).

Then in GitHub > Settings > Secrets and variables > Actions set variables
`AZURE_RESOURCE_GROUP`, `AZURE_PREFIX` and the secret `AZURE_CREDENTIALS` (the group's
service principal). The deploy job is skipped until `AZURE_PREFIX` exists.

## Secrets

None in the repository. Locally they live in `.env` (gitignored); in Azure they are
Container App secrets set by Bicep; in CI they are GitHub secrets. If one leaks: revoke or
rotate it first, then remove it, then tell the professor (Assignment 2 §5). A database
password is rotated by running `infra/setup.sh` again with a new value.

## Security model

- Each service has its own database user, in both compose and Azure, and cannot open the
  other service's database ([ADR-7](docs/decisions.md#adr-7-database-access-in-azure)).
- The APIs have **no sign-in, by design**: LiftLog is a single-user demo with test data.
  CORS stops other websites from calling them, but anyone with a service URL can use the
  API directly ([ADR-8](docs/decisions.md#adr-8-no-user-accounts-in-the-api)).

## Monitoring

Each service logs one JSON line per request (method, path, status, duration; INFO level,
no request bodies) to stdout, which Container Apps sends to the Log Analytics workspace
`<prefix>-logs`. The queries in [monitoring/queries.kql](monitoring/queries.kql) are
deployed by Bicep as saved queries: in the Azure portal open the workspace, then
**Logs > Queries > LiftLog**.

- **Dashboard:** *1. Request count*, *2. Error rate (5xx)* and *3. Response time
  p50/p95/p99*, per service, as time charts. *6. Slowest endpoints* and *7. Recent
  errors* help when one of them looks wrong.
- **SLO:** **99% of GET requests to the workouts API are answered without a server error
  in under 500 ms, measured over a rolling 7 days.** *4. SLO* gives the SLI, whether the
  target is met and how much error budget is left; *5. SLO daily* shows the SLI per day.
  Cold starts (a Container App scaling up from zero, a database waking from auto-pause)
  count against the budget on purpose, because users feel them; they are the main way
  this SLO is missed on a demo with little traffic.

## Team

| Name | GitHub | Owns |
|---|---|---|
| _name_ | @_username_ | platform (CI/CD, Azure, monitoring) + progress service |
| _name_ | @_username_ | workouts service |
| _name_ | @_username_ | UI |

Scrum roles per sprint: [docs/scrum/](docs/scrum/).
