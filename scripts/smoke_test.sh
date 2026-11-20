#!/usr/bin/env bash
# Post-deploy smoke test (#23): proves a deploy really works, not just that /health answers.
# Creates an exercise and a workout on the live workouts API, reads them back, asks the
# progress service for the next session (so progress -> workouts over HTTP is exercised
# too), then deletes what it created. Any wrong answer exits non-zero and fails the run.
#
#   WORKOUTS_URL=https://... PROGRESS_URL=https://... scripts/smoke_test.sh
#   WORKOUTS_URL=http://localhost:8001 PROGRESS_URL=http://localhost:8002 scripts/smoke_test.sh
set -euo pipefail

: "${WORKOUTS_URL:?set WORKOUTS_URL}"
: "${PROGRESS_URL:?set PROGRESS_URL}"
TAG="${SMOKE_TAG:-${GITHUB_SHA:-local}}"
NAME="Smoke test ${TAG:0:7} $(date -u +%H%M%S)"

EXERCISE_ID=""
WORKOUT_ID=""
BODY=$(mktemp)

fail() { echo "::error::smoke test: $*" >&2; echo "last response: $(cat "$BODY")" >&2; exit 1; }

# call <METHOD> <URL> <expected status> [json body]; the response body lands in $BODY
call() {
  local status
  status=$(curl -sS --max-time 60 --retry 2 --retry-connrefused -o "$BODY" -w '%{http_code}' \
    -X "$1" -H 'Content-Type: application/json' ${4:+--data "$4"} "$2") \
    || fail "$1 $2: no answer"
  [[ "$status" == "$3" ]] || fail "$1 $2 returned ${status}, expected $3"
  echo "ok  $1 ${2#*://*/} -> ${status}"
}
field() { jq -er "$1" "$BODY" || fail "response has no $1"; }

# whatever happens, leave no test data behind (the workout first: it holds the exercise)
cleanup() {
  [[ -n "$WORKOUT_ID" ]] && curl -sS --max-time 30 -o /dev/null -X DELETE "${WORKOUTS_URL}/workouts/${WORKOUT_ID}" || true
  [[ -n "$EXERCISE_ID" ]] && curl -sS --max-time 30 -o /dev/null -X DELETE "${WORKOUTS_URL}/exercises/${EXERCISE_ID}" || true
  rm -f "$BODY"
}
trap cleanup EXIT

echo "Smoke test against ${WORKOUTS_URL} and ${PROGRESS_URL}"

# 1. create an exercise and read it back
call POST "${WORKOUTS_URL}/exercises" 201 \
  "$(jq -nc --arg n "$NAME" '{name: $n, body_part: "upper", rep_range_min: 8, rep_range_max: 12}')"
EXERCISE_ID=$(field .id)
call GET "${WORKOUTS_URL}/exercises/${EXERCISE_ID}" 200
[[ "$(field .name)" == "$NAME" ]] || fail "exercise ${EXERCISE_ID} came back with another name"

# 2. log a workout where every set reaches the top of the rep range, and read it back
call POST "${WORKOUTS_URL}/workouts" 201 \
  "$(jq -nc --arg d "$(date -u +%F)" --argjson e "$EXERCISE_ID" \
     '{performed_on: $d, notes: "pipeline smoke test",
       sets: [{exercise_id: $e, weight_kg: 20, reps: 12}, {exercise_id: $e, weight_kg: 20, reps: 12}]}')"
WORKOUT_ID=$(field .id)
call GET "${WORKOUTS_URL}/workouts/${WORKOUT_ID}" 200
[[ "$(field '.sets | length')" == "2" ]] || fail "workout ${WORKOUT_ID} did not keep its 2 sets"

# 3. progress reads that history from workouts and recommends more weight
call GET "${PROGRESS_URL}/exercises/${EXERCISE_ID}/next-session" 200
[[ "$(field .action)" == "increase_weight" ]] || fail "expected increase_weight from the coach"
[[ "$(field .weight_kg)" == "22.5" ]] || fail "expected 22.5 kg (20 kg + 2.5 kg upper body)"

# 4. delete both and check they are gone
call DELETE "${WORKOUTS_URL}/workouts/${WORKOUT_ID}" 204
WORKOUT_ID=""
call DELETE "${WORKOUTS_URL}/exercises/${EXERCISE_ID}" 204
call GET "${WORKOUTS_URL}/exercises/${EXERCISE_ID}" 404
EXERCISE_ID=""

echo "Smoke test passed"
