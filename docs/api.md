# API contracts between services

Only the calls one service makes to another are listed here. Each service's full API is
in its OpenAPI page (`/docs` on the service URL).

## progress → workouts: exercise history

`GET /exercises/{exercise_id}/history?limit=N`

Used by the progress service for the next-session coach (`limit=1`) and for PR detection.
Owned by the workouts service; change it only together with its callers in progress.

`200 OK`, sessions newest first, at most `limit` of them (default: all):

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
      "workout_id": 17,
      "performed_on": "2026-11-17",
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
- Only sets of this exercise appear in `sets`, ordered by `set_number`.
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
  "reason": "Every set at 60.0 kg reached 12 reps. Add weight and start again at 8 reps."
}
```

`action` is one of `increase_weight`, `add_reps`, `deload`, `no_history`. With
`no_history`, `based_on`, `weight_kg`, `target_reps` and `sets` are `null` and `reason`
says what to do instead. Show `reason` to the user as-is.
