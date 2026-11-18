"""SQL for the workouts domain: reads and writes only, no business rules.

The schema lives in migrations/*.sql.
"""

from datetime import date

from app.db import Connection

# ---------- exercises ----------

EXERCISE_COLUMNS = "id, name, body_part, rep_range_min, rep_range_max"


def insert_exercise(conn: Connection, name: str, body_part: str, rep_min: int, rep_max: int) -> int:
    return conn.execute(
        """INSERT INTO exercises (name, body_part, rep_range_min, rep_range_max)
           OUTPUT INSERTED.id VALUES (%s, %s, %s, %s)""",
        (name, body_part, rep_min, rep_max),
    ).fetchone()["id"]


def get_exercise(conn: Connection, exercise_id: int) -> dict | None:
    return conn.execute(
        "SELECT id, name, body_part, rep_range_min, rep_range_max FROM exercises WHERE id = %s",
        (exercise_id,),
    ).fetchone()


def get_exercise_by_name(conn: Connection, name: str) -> dict | None:
    return conn.execute(
        "SELECT id, name, body_part, rep_range_min, rep_range_max FROM exercises WHERE name = %s",
        (name,),
    ).fetchone()


def list_exercises(conn: Connection) -> list[dict]:
    return conn.execute(
        "SELECT id, name, body_part, rep_range_min, rep_range_max FROM exercises ORDER BY name"
    ).fetchall()


def update_exercise(
    conn: Connection, exercise_id: int, name: str, body_part: str, rep_min: int, rep_max: int
) -> bool:
    return (
        conn.execute(
            """UPDATE exercises SET name = %s, body_part = %s, rep_range_min = %s, rep_range_max = %s
               WHERE id = %s""",
            (name, body_part, rep_min, rep_max, exercise_id),
        ).rowcount
        == 1
    )


def delete_exercise(conn: Connection, exercise_id: int) -> bool:
    return conn.execute("DELETE FROM exercises WHERE id = %s", (exercise_id,)).rowcount == 1


def exercise_has_sets(conn: Connection, exercise_id: int) -> bool:
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM workout_sets WHERE exercise_id = %s", (exercise_id,)
    ).fetchone()
    return row["n"] > 0


def existing_exercise_ids(conn: Connection) -> set[int]:
    return {r["id"] for r in conn.execute("SELECT id FROM exercises").fetchall()}


# ---------- workouts ----------


def insert_workout(conn: Connection, performed_on: date, notes: str) -> int:
    return conn.execute(
        "INSERT INTO workouts (performed_on, notes) OUTPUT INSERTED.id VALUES (%s, %s)",
        (performed_on, notes),
    ).fetchone()["id"]


def update_workout(conn: Connection, workout_id: int, performed_on: date, notes: str) -> bool:
    return (
        conn.execute(
            "UPDATE workouts SET performed_on = %s, notes = %s WHERE id = %s",
            (performed_on, notes, workout_id),
        ).rowcount
        == 1
    )


def delete_workout(conn: Connection, workout_id: int) -> bool:
    return conn.execute("DELETE FROM workouts WHERE id = %s", (workout_id,)).rowcount == 1


def get_workout(conn: Connection, workout_id: int) -> dict | None:
    return conn.execute(
        "SELECT id, performed_on, notes FROM workouts WHERE id = %s", (workout_id,)
    ).fetchone()


def list_workouts(conn: Connection, date_from: date | None, date_to: date | None) -> list[dict]:
    return conn.execute(
        """SELECT w.id, w.performed_on, w.notes,
                  (SELECT COUNT(*) FROM workout_sets s WHERE s.workout_id = w.id) AS set_count
           FROM workouts w
           WHERE (%s IS NULL OR w.performed_on >= %s) AND (%s IS NULL OR w.performed_on <= %s)
           ORDER BY w.performed_on DESC, w.id DESC""",
        (date_from, date_from, date_to, date_to),
    ).fetchall()


def insert_set(
    conn: Connection, workout_id: int, exercise_id: int, set_number: int, weight_kg: float, reps: int
) -> None:
    conn.execute(
        """INSERT INTO workout_sets (workout_id, exercise_id, set_number, weight_kg, reps)
           VALUES (%s, %s, %s, %s, %s)""",
        (workout_id, exercise_id, set_number, weight_kg, reps),
    )


def delete_sets(conn: Connection, workout_id: int) -> None:
    conn.execute("DELETE FROM workout_sets WHERE workout_id = %s", (workout_id,))


def list_sets(conn: Connection, workout_id: int) -> list[dict]:
    return conn.execute(
        """SELECT s.exercise_id, e.name AS exercise_name, s.set_number, s.weight_kg, s.reps
           FROM workout_sets s JOIN exercises e ON e.id = s.exercise_id
           WHERE s.workout_id = %s
           ORDER BY s.id""",
        (workout_id,),
    ).fetchall()


# ---------- history ----------


def exercise_history(conn: Connection, exercise_id: int, limit: int) -> list[dict]:
    """Sets of one exercise from its `limit` most recent workouts, newest first."""
    return conn.execute(
        """SELECT w.id AS workout_id, w.performed_on, s.set_number, s.weight_kg, s.reps
           FROM (
               SELECT TOP (%s) w.id, w.performed_on
               FROM workouts w
               WHERE EXISTS (SELECT 1 FROM workout_sets x
                             WHERE x.workout_id = w.id AND x.exercise_id = %s)
               ORDER BY w.performed_on DESC, w.id DESC
           ) w
           JOIN workout_sets s ON s.workout_id = w.id AND s.exercise_id = %s
           ORDER BY w.performed_on DESC, w.id DESC, s.set_number""",
        (limit, exercise_id, exercise_id),
    ).fetchall()
