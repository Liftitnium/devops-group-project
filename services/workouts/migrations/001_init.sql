-- Exercises, workouts and the sets performed in them. See docs/data-model.md.

CREATE TABLE exercises (
    id            INT IDENTITY(1, 1) PRIMARY KEY,
    name          NVARCHAR(100) NOT NULL,
    body_part     NVARCHAR(5)   NOT NULL,
    rep_range_min INT           NOT NULL,
    rep_range_max INT           NOT NULL,
    created_at    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT uq_exercises_name UNIQUE (name),
    CONSTRAINT ck_exercises_body_part CHECK (body_part IN ('upper', 'lower')),
    CONSTRAINT ck_exercises_rep_range CHECK (rep_range_min >= 1 AND rep_range_min <= rep_range_max)
);

CREATE TABLE workouts (
    id           INT IDENTITY(1, 1) PRIMARY KEY,
    performed_on DATE          NOT NULL,
    notes        NVARCHAR(500) NOT NULL DEFAULT '',
    created_at   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE INDEX ix_workouts_performed_on ON workouts (performed_on DESC);

-- deleting a workout deletes its sets; an exercise with sets cannot be deleted
CREATE TABLE workout_sets (
    id          INT IDENTITY(1, 1) PRIMARY KEY,
    workout_id  INT          NOT NULL REFERENCES workouts (id) ON DELETE CASCADE,
    exercise_id INT          NOT NULL REFERENCES exercises (id),
    set_number  INT          NOT NULL,
    weight_kg   DECIMAL(6, 2) NOT NULL,
    reps        INT          NOT NULL,
    CONSTRAINT uq_sets_number UNIQUE (workout_id, exercise_id, set_number),
    CONSTRAINT ck_sets_weight CHECK (weight_kg >= 0),
    CONSTRAINT ck_sets_reps CHECK (reps >= 1)
);

CREATE INDEX ix_sets_exercise ON workout_sets (exercise_id, workout_id);
