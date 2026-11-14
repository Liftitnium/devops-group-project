# Data model

**Must match the migrations** in `services/*/migrations/`. The skeleton has no domain
tables yet; this is the plan. Each owner updates their half in the same PR as the migration.

## workouts database

```mermaid
erDiagram
    EXERCISE ||--o{ WORKOUT_SET : "performed as"
    WORKOUT  ||--o{ WORKOUT_SET : contains
    EXERCISE {
        int id PK
        string name UK
        string body_part "upper | lower"
        int rep_range_min
        int rep_range_max
    }
    WORKOUT {
        int id PK
        date performed_on
        string notes
    }
    WORKOUT_SET {
        int id PK
        int workout_id FK
        int exercise_id FK
        int set_number
        decimal weight_kg
        int reps
    }
```

## progress database

No foreign keys to the workouts database (it is another service). `exercise_id` is a
reference by value, checked through the workouts API.

```mermaid
erDiagram
    GOAL {
        int id PK
        int exercise_id "ref to workouts"
        decimal target_weight_kg
        int target_reps
        date target_date
    }
    PERSONAL_RECORD {
        int id PK
        int exercise_id "ref to workouts"
        decimal weight_kg
        int reps
        date achieved_on
    }
```
