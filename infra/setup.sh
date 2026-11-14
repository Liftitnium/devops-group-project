#!/usr/bin/env bash
# One-time (and repeatable) Azure setup: deploys infra/main.bicep into the group's
# existing resource group. Run from the repo root by a member logged in with `az login`
# (IE account, Contributor on the resource group). Re-running it is safe: Bicep only
# changes what differs, and the images currently running are kept.
#
#   CLASS=3a SQL_ADMIN_PASSWORD='...' IMAGE_TAG=<commit sha pushed to GHCR> infra/setup.sh
#
# Optional, only if the GHCR packages are private:
#   GHCR_USERNAME=<github user> GHCR_TOKEN=<token with read:packages>
set -euo pipefail

: "${CLASS:?set CLASS, e.g. CLASS=3a}"
: "${SQL_ADMIN_PASSWORD:?set SQL_ADMIN_PASSWORD (8+ chars, upper, lower, digit)}"
GROUP=6
PREFIX="sdd-${CLASS}-g${GROUP}"
RG="rg-sdd-${CLASS}-g${GROUP}"
OWNER="liftitnium"   # GHCR image names are lowercase

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

WORKOUTS_IMAGE=$(image_for workouts)
PROGRESS_IMAGE=$(image_for progress)
echo "Deploying ${PREFIX} into ${RG}"
echo "  workouts image: ${WORKOUTS_IMAGE}"
echo "  progress image: ${PROGRESS_IMAGE}"

az deployment group create \
  --resource-group "$RG" \
  --name "liftlog-$(date +%Y%m%d%H%M%S)" \
  --template-file infra/main.bicep \
  --parameters prefix="$PREFIX" \
               sqlAdminPassword="$SQL_ADMIN_PASSWORD" \
               workoutsImage="$WORKOUTS_IMAGE" \
               progressImage="$PROGRESS_IMAGE" \
               ghcrUsername="${GHCR_USERNAME:-}" \
               ghcrToken="${GHCR_TOKEN:-}" \
  --query 'properties.outputs' -o json

cat <<NEXT

Done. Now set these in GitHub > Settings > Secrets and variables > Actions:
  variable AZURE_RESOURCE_GROUP = ${RG}
  variable AZURE_PREFIX         = ${PREFIX}
  secret   AZURE_CREDENTIALS    = the group service principal JSON from the professor
After that, every merge to main deploys automatically.
NEXT
