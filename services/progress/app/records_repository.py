"""SQL for personal records: reads and writes only, no business rules.

The schema lives in migrations/002_personal_records.sql.
"""

from datetime import date
from decimal import Decimal

from app.db import Connection


def list_records(conn: Connection, exercise_id: int | None) -> list[dict]:
    return conn.execute(
        """SELECT exercise_id, reps, weight_kg, achieved_on FROM personal_records
           WHERE (%s IS NULL OR exercise_id = %s)
           ORDER BY exercise_id, reps""",
        (exercise_id, exercise_id),
    ).fetchall()


def delete_records(conn: Connection, exercise_id: int) -> None:
    conn.execute("DELETE FROM personal_records WHERE exercise_id = %s", (exercise_id,))


def insert_record(
    conn: Connection, exercise_id: int, reps: int, weight_kg: Decimal, achieved_on: date
) -> None:
    conn.execute(
        """INSERT INTO personal_records (exercise_id, reps, weight_kg, achieved_on)
           VALUES (%s, %s, %s, %s)""",
        (exercise_id, reps, weight_kg, achieved_on),
    )
