# Workouts API

Base URL: the workouts Container App (`WORKOUTS_URL`), `http://localhost:8001` locally.
Interactive docs at `/docs`. Every error is `{"detail": "<sentence you can show the user>"}`.

## Exercises

`POST /exercises` → `201`

```json
{"name": "Bench press", "body_part": "upper", "rep_range_min": 8, "rep_range_max": 12}
```

Returns the exercise with its `id`:

```json
{"id": 3, "name": "Bench press", "body_part": "upper", "rep_range_min": 8, "rep_range_max": 12}
```

- `body_part` is `"upper"` or `"lower"`; reps are 1–100 with min ≤ max; the name is trimmed, 1–100 characters.
- `422` on invalid input, e.g. `{"detail": "rep_range_min must be less than or equal to rep_range_max"}`.
- `409` if another exercise has the same name.

`GET /exercises` → `200`, all exercises sorted by name.
`GET /exercises/{id}` → `200` or `404`.
`PUT /exercises/{id}` → `200`, same body as POST, replaces every field.
`DELETE /exercises/{id}` → `204`, or `409` if any workout uses it (delete those workouts first).

## Workouts

`POST /workouts` → `201`

```json
{
  "performed_on": "2026-11-17",
  "notes": "felt strong",
  "sets": [
    {"exercise_id": 3, "weight_kg": 60, "reps": 12},
    {"exercise_id": 3, "weight_kg": 60, "reps": 11}
  ]
}
```

Returns the workout with its sets. Sets are numbered per exercise in the order sent:

```json
{
  "id": 17,
  "performed_on": "2026-11-17",
  "notes": "felt strong",
  "sets": [
    {"exercise_id": 3, "exercise_name": "Bench press", "set_number": 1, "weight_kg": 60.0, "reps": 12},
    {"exercise_id": 3, "exercise_name": "Bench press", "set_number": 2, "weight_kg": 60.0, "reps": 11}
  ]
}
```

- `notes` is optional (max 500 characters); `weight_kg` 0–1000; `reps` at least 1.
- `422` if a set names an exercise that doesn't exist; nothing is saved.

`GET /workouts?from=2026-11-01&to=2026-11-30` → `200`, newest first; both filters optional:

```json
[{"id": 17, "performed_on": "2026-11-17", "notes": "felt strong", "set_count": 2}]
```

`GET /workouts/{id}` → `200` (same shape as POST) or `404`.
`PUT /workouts/{id}` → `200`, same body as POST; replaces the date, notes and **all** sets.
`DELETE /workouts/{id}` → `204`; its sets are deleted too.

## Exercise history

`GET /exercises/{id}/history?limit=N` → used by the progress service (coach and PRs).
Shape and rules are in [api.md](api.md) on the coach branch; this implementation matches
it exactly (test: `test_history_matches_the_contract_newest_first_and_only_this_exercise`).
