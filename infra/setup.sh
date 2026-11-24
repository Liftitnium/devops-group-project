#!/usr/bin/env bash
# One-time (and repeatable) Azure setup: deploys infra/main.bicep into the group's
# existing resource group and gives each service its own database user. Run from the repo
# root by a member logged in with `az login` (IE account, Contributor on the resource
# group). Re-running it is safe: Bicep only changes what differs, the images currently
# running are kept, and the database users only get their passwords re-applied.
#
#   CLASS=3a SQL_ADMIN_PASSWORD='...' WORKOUTS_DB_PASSWORD='...' PROGRESS_DB_PASSWORD='...' \
#     IMAGE_TAG=<commit sha pushed to GHCR> infra/setup.sh
#
# SQL_ADMIN_PASSWORD is only used here, to create the two service users; the services
# themselves connect as workouts_app and progress_app (see docs/decisions.md, ADR-2).
# Needs sqlcmd on the PATH, or Docker (it then runs the sqlcmd from the SQL Server image).
#
# Optional, only if the GHCR packages are private:
#   GHCR_USERNAME=<github user> GHCR_TOKEN=<token with read:packages>
# Optional regions (default: the resource group's region, UI in westeurope):
#   LOCATION=germanywestcentral UI_LOCATION=westeurope
# Optional, for a subscription whose region policy blocks Static Web Apps (personal
# Azure for Students): DEPLOY_UI=false EXTRA_ORIGINS=http://localhost:8080
set -euo pipefail

: "${CLASS:?set CLASS, e.g. CLASS=3a}"
: "${SQL_ADMIN_PASSWORD:?set SQL_ADMIN_PASSWORD (8+ chars, upper, lower, digit)}"
: "${WORKOUTS_DB_PASSWORD:?set WORKOUTS_DB_PASSWORD (8+ chars, upper, lower, digit)}"
: "${PROGRESS_DB_PASSWORD:?set PROGRESS_DB_PASSWORD (8+ chars, upper, lower, digit)}"
GROUP=6
PREFIX="sdd-${CLASS}-g${GROUP}"
RG="rg-sdd-${CLASS}-g${GROUP}"
OWNER="liftitnium"   # GHCR image names are lowercase
SQL_SERVER="${PREFIX}-sql"
SQL_ADMIN_LOGIN="liftlog_admin"
SQLCMD_IMAGE="mcr.microsoft.com/mssql/server:2025-CU10-GDR1-ubuntu-22.04"

# keep whatever image is running; a fresh install needs IMAGE_TAG
image_for() {
  local current
  current=$(az containerapp show -g "$RG" -n "${PREFIX}-$1" \
    --query 'properties.template.containers[0].image' -o tsv 2>/dev/null || true)
  if [[ -n "$current" ]]; then
    echo "$current"
  else
    echo "ghcr.io/${OWNER}/liftlog-$1:${IMAGE_TAG:?first install: set IMAGE_TAG to a commit SHA whose images are in GHCR}"
  fi
}

# Runs infra/sql/app-user.sql as the admin against one database. The firewall only lets
# Azure services in, so this machine's public IP is allowed while the users are created
# and the rule is removed afterwards, also when something fails (trap on EXIT).
FW_RULES=()
allow_ip() {
  local rule="setup-$(date +%Y%m%d%H%M%S)-${#FW_RULES[@]}"
  echo "  allowing $1 on ${SQL_SERVER} while setup runs (rule ${rule})"
  az sql server firewall-rule create -g "$RG" -s "$SQL_SERVER" -n "$rule" \
    --start-ip-address "$1" --end-ip-address "$1" --output none
  FW_RULES+=("$rule")
}
close_firewall() {
  local rule
  for rule in "${FW_RULES[@]+"${FW_RULES[@]}"}"; do
    az sql server firewall-rule delete -g "$RG" -s "$SQL_SERVER" -n "$rule" --output none \
      || echo "WARNING: remove firewall rule ${rule} on ${SQL_SERVER} by hand" >&2
  done
  FW_RULES=()
}
trap close_firewall EXIT

sqlcmd_as_admin() {   # <database> <user> <password>
  local host="${SQL_SERVER}.database.windows.net"
  # passwords travel as environment variables, never on a command line
  if command -v sqlcmd >/dev/null; then
    SQLCMDPASSWORD="$SQL_ADMIN_PASSWORD" APP_USER="$2" APP_PASSWORD="$3" \
      sqlcmd -S "$host" -d "$1" -U "$SQL_ADMIN_LOGIN" -b -l 60 -i infra/sql/app-user.sql
  else
    SQLCMDPASSWORD="$SQL_ADMIN_PASSWORD" APP_USER="$2" APP_PASSWORD="$3" \
      docker run --rm --platform linux/amd64 \
        -e SQLCMDPASSWORD -e APP_USER -e APP_PASSWORD \
        -v "$PWD/infra/sql/app-user.sql:/app-user.sql:ro" \
        --entrypoint /opt/mssql-tools18/bin/sqlcmd "$SQLCMD_IMAGE" \
        -S "$host" -d "$1" -U "$SQL_ADMIN_LOGIN" -b -l 60 -i /app-user.sql
  fi
}

# Some networks (campus, VPN) leave through several addresses, so the IP an echo service
# sees may not be the one SQL sees. SQL names the address it refused: allow that one too
# and try again, up to four times.
run_app_user_sql() {   # <database> <user> <password>
  local out ip attempt
  for attempt in 1 2 3 4 5; do
    if out=$(sqlcmd_as_admin "$@" 2>&1); then echo "$out"; return; fi
    ip=$(grep -oE "Client with IP address '[0-9.]+'" <<<"$out" | grep -oE '[0-9.]+' | head -1 || true)
    [[ -n "$ip" && "$attempt" -lt 5 ]] || { echo "$out" >&2; return 1; }
    allow_ip "$ip"
    echo "  waiting for the new firewall rule to apply"
    sleep 30
  done
}

create_app_users() {
  allow_ip "$(curl -fsS --max-time 10 https://api.ipify.org)"
  # a paused serverless database wakes on the first login; -l 60 waits for it
  run_app_user_sql "${PREFIX}-workouts-db" workouts_app "$WORKOUTS_DB_PASSWORD"
  run_app_user_sql "${PREFIX}-progress-db" progress_app "$PROGRESS_DB_PASSWORD"
  close_firewall
}

WORKOUTS_IMAGE=$(image_for workouts)
PROGRESS_IMAGE=$(image_for progress)
echo "Deploying ${PREFIX} into ${RG}"
echo "  workouts image: ${WORKOUTS_IMAGE}"
echo "  progress image: ${PROGRESS_IMAGE}"

# On a re-run the databases exist already: create the users first, so the new revisions
# that connect as them find them. On a first install the users come after the deploy.
FIRST_INSTALL=true
if az sql db show -g "$RG" -s "$SQL_SERVER" -n "${PREFIX}-progress-db" --output none 2>/dev/null; then
  FIRST_INSTALL=false
  echo "Creating the service database users"
  create_app_users
fi

az deployment group create \
  --resource-group "$RG" \
  --name "liftlog-$(date +%Y%m%d%H%M%S)" \
  --template-file infra/main.bicep \
  --parameters prefix="$PREFIX" \
               sqlAdminLogin="$SQL_ADMIN_LOGIN" \
               sqlAdminPassword="$SQL_ADMIN_PASSWORD" \
               workoutsDbPassword="$WORKOUTS_DB_PASSWORD" \
               progressDbPassword="$PROGRESS_DB_PASSWORD" \
               workoutsImage="$WORKOUTS_IMAGE" \
               progressImage="$PROGRESS_IMAGE" \
               ghcrUsername="${GHCR_USERNAME:-}" \
               ghcrToken="${GHCR_TOKEN:-}" \
               ${LOCATION:+location="$LOCATION"} \
               uiLocation="${UI_LOCATION:-westeurope}" \
               deployUi="${DEPLOY_UI:-true}" \
               extraOrigins="${EXTRA_ORIGINS:-}" \
  --query 'properties.outputs' -o json

if [[ "$FIRST_INSTALL" == true ]]; then
  echo "Creating the service database users"
  create_app_users
  # the first revisions started before their users existed; start them again
  for svc in workouts progress; do
    rev=$(az containerapp show -g "$RG" -n "${PREFIX}-${svc}" --query properties.latestRevisionName -o tsv)
    az containerapp revision restart -g "$RG" -n "${PREFIX}-${svc}" --revision "$rev" --output none
  done
fi

cat <<NEXT

Done. Now set these in GitHub > Settings > Secrets and variables > Actions:
  variable AZURE_RESOURCE_GROUP = ${RG}
  variable AZURE_PREFIX         = ${PREFIX}
  secret   AZURE_CREDENTIALS    = the group service principal JSON from the professor
After that, every merge to main deploys automatically.
NEXT
