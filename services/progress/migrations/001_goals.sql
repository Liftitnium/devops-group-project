-- Goals: lift target_weight_kg for target_reps on an exercise by target_date.
-- See docs/data-model.md.
-- exercise_id refers to the workouts service's database, so it has no foreign key;
-- the API checks it against the workouts service when a goal is created or changed.

CREATE TABLE goals (
    id               INT IDENTITY(1, 1) PRIMARY KEY,
    exercise_id      INT           NOT NULL,
    target_weight_kg DECIMAL(6, 2) NOT NULL,
    target_reps      INT           NOT NULL,
    target_date      DATE          NOT NULL,
    created_at       DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT ck_goals_weight CHECK (target_weight_kg > 0),
    CONSTRAINT ck_goals_reps CHECK (target_reps >= 1)
);

CREATE INDEX ix_goals_exercise ON goals (exercise_id);
