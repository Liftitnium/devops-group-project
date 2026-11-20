"""SQL for goals: reads and writes only, no business rules.

The schema lives in migrations/001_goals.sql.
"""

from datetime import date
from decimal import Decimal

from app.db import Connection


def insert_goal(
    conn: Connection, exercise_id: int, target_weight_kg: Decimal, target_reps: int, target_date: date
) -> int:
    return conn.execute(
        """INSERT INTO goals (exercise_id, target_weight_kg, target_reps, target_date)
           OUTPUT INSERTED.id VALUES (%s, %s, %s, %s)""",
        (exercise_id, target_weight_kg, target_reps, target_date),
    ).fetchone()["id"]


def get_goal(conn: Connection, goal_id: int) -> dict | None:
    return conn.execute(
        "SELECT id, exercise_id, target_weight_kg, target_reps, target_date FROM goals WHERE id = %s",
        (goal_id,),
    ).fetchone()


def list_goals(conn: Connection, exercise_id: int | None) -> list[dict]:
    return conn.execute(
        """SELECT id, exercise_id, target_weight_kg, target_reps, target_date FROM goals
           WHERE (%s IS NULL OR exercise_id = %s)
           ORDER BY target_date, id""",
        (exercise_id, exercise_id),
    ).fetchall()


def update_goal(
    conn: Connection,
    goal_id: int,
    exercise_id: int,
    target_weight_kg: Decimal,
    target_reps: int,
    target_date: date,
) -> bool:
    return (
        conn.execute(
            """UPDATE goals SET exercise_id = %s, target_weight_kg = %s, target_reps = %s, target_date = %s
               WHERE id = %s""",
            (exercise_id, target_weight_kg, target_reps, target_date, goal_id),
        ).rowcount
        == 1
    )


def delete_goal(conn: Connection, goal_id: int) -> bool:
    return conn.execute("DELETE FROM goals WHERE id = %s", (goal_id,)).rowcount == 1
