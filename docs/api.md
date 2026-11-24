# API contracts between services

Only the calls one service makes to another are listed here. Each service's full API is
in its OpenAPI page (`/docs` on the service URL).

## progress → workouts: exercise history

`GET /exercises/{exercise_id}/history?limit=N`

Used by the progress service for the next-session coach (`limit=1`) and for PR detection.
Owned by the workouts service; change it only together with its callers in progress.

A **session is one day**: every set of this exercise logged on that date, even if the day was
saved as several workouts. `200 OK`, sessions newest first, at most `limit` days (default:
all):

```json
{
  "exercise": {
    "id": 3,
    "name": "Bench press",
    "body_part": "upper",
    "rep_range_min": 8,
    "rep_range_max": 12
  },
  "sessions": [
    {
      "performed_on": "2026-11-17",
      "workout_ids": [17],
      "sets": [
        {"set_number": 1, "weight_kg": 60.0, "reps": 12},
        {"set_number": 2, "weight_kg": 60.0, "reps": 11}
      ]
    }
  ]
}
```

- `body_part` is `"upper"` or `"lower"`.
- `sessions` is `[]` when the exercise exists but was never performed.
- Only sets of this exercise appear in `sets`. They are numbered 1, 2, 3… across the day in the
  order they were logged (by workout, then by set), so `set_number` here can differ from the
  number inside one workout.
- `workout_ids` lists the workouts of that day that contain this exercise, oldest first.
- `404` when the exercise does not exist.

Progress answers `503` with a readable message if this call times out (3 s) or the workouts
service is down, and `502` if the answer does not match this shape.

## UI → progress: next session

`GET /exercises/{exercise_id}/next-session`

```json
{
  "exercise_id": 3,
  "exercise_name": "Bench press",
  "based_on": "2026-11-17",
  "action": "increase_weight",
  "weight_kg": 62.5,
  "target_reps": 8,
  "sets": 3,
  "reason": "Every set at 60 kg reached 12 reps. Add weight and start again at 8 reps."
}
```

`404` with `{"detail": "Exercise 3 not found."}` when the exercise does not exist,
`503` when the workouts service is down, `502` when it sends unusable data. Every error
has a `detail` the UI can show as-is.

`action` is one of `increase_weight`, `add_reps`, `deload`, `no_history`. With
`no_history`, `based_on`, `weight_kg`, `target_reps` and `sets` are `null` and `reason`
says what to do instead. Show `reason` to the user as-is.

## UI → progress: goals (#21)

`POST /goals`, `GET /goals[?exercise_id=N]`, `GET /goals/{id}`, `PUT /goals/{id}`,
`DELETE /goals/{id}` (`204`). Request body for `POST` and `PUT`:

```json
{"exercise_id": 3, "target_weight_kg": 62.5, "target_reps": 8, "target_date": "2026-12-19"}
```

Responses are the same object plus `id`. `GET /goals` is ordered by `target_date`.

- `422` with a readable `detail` for bad fields (`target_weight_kg` > 0, at most 2 decimals and
  ≤ 1000; `target_reps` 1–100), for a new goal with a past `target_date`, and for an
  `exercise_id` the workouts service does not know.
- `404` `{"detail": "Goal 9 not found."}`.
- `POST`, and `PUT` when it changes `exercise_id`, ask workouts whether the exercise exists, so
  they are `503` while workouts is down. List, read, other updates and delete only use the
  progress database and keep working.

`GET /goals/{id}/progress`: how close the goal is, from the full workouts history. The best
attempt is the heaviest set done for at least `target_reps` reps.

```json
{
  "goal": {"id": 1, "exercise_id": 3, "target_weight_kg": 60.0, "target_reps": 8, "target_date": "2026-12-19"},
  "exercise_name": "Bench press",
  "best_weight_kg": 57.5,
  "best_on": "2026-11-17",
  "percent": 96,
  "achieved": false,
  "days_left": 30
}
```

`best_weight_kg` and `best_on` are `null` with no qualifying set (`percent` 0). `percent` is
capped at 100; `days_left` is negative once the date has passed. `503` while workouts is down.

## UI → progress: personal records (#20)

`GET /exercises/{exercise_id}/records`: the heaviest weight for each exact rep count, worked
out from the full workouts history, fewest reps first. Each call also saves them, and `new` is
`true` when a PR beats what was saved at the previous call (or there was none), so the UI can
highlight it.

```json
{
  "exercise_id": 3,
  "exercise_name": "Bench press",
  "records": [
    {"reps": 5, "weight_kg": 70.0, "achieved_on": "2026-11-17", "new": false},
    {"reps": 8, "weight_kg": 62.5, "achieved_on": "2026-11-17", "new": true}
  ]
}
```

`records` is `[]` when the exercise was never performed. `404` when the exercise does not
exist, `503` while workouts is down, `502` when it sends unusable history.

`GET /records[?exercise_id=N]`: the PRs saved at the last check of each exercise, ordered by
`exercise_id` then `reps`, as `[{"exercise_id", "reps", "weight_kg", "achieved_on"}]`. It only
reads the progress database, so it keeps working while workouts is down.
