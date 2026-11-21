-- Personal records: the heaviest weight lifted for each rep count on an exercise.
-- See docs/data-model.md.
-- Rebuilt from the workouts history every time an exercise's records are requested
-- (GET /exercises/{id}/records), so a deleted or corrected workout also corrects its PRs.
-- Kept here so GET /records can show the last known PRs even while workouts is down.
-- exercise_id refers to the workouts service's database, so it has no foreign key.

CREATE TABLE personal_records (
    id          INT IDENTITY(1, 1) PRIMARY KEY,
    exercise_id INT           NOT NULL,
    reps        INT           NOT NULL,
    weight_kg   DECIMAL(6, 2) NOT NULL,
    achieved_on DATE          NOT NULL,
    created_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT uq_records_exercise_reps UNIQUE (exercise_id, reps),
    CONSTRAINT ck_records_weight CHECK (weight_kg >= 0),
    CONSTRAINT ck_records_reps CHECK (reps >= 1)
);
