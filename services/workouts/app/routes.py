"""HTTP endpoints for exercises, workouts and exercise history.

Business rules (duplicate names, unknown exercises, deleting a used exercise) live here
and raise DomainErrors; main.py turns those into status codes. SQL is in repository.py.
"""

from collections import Counter
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app import repository as repo
from app.db import Connection, get_db
from app.errors import ConflictError, InvalidInputError, NotFoundError
from app.schemas import (
    Exercise,
    ExerciseIn,
    History,
    HistorySet,
    Session,
    Workout,
    WorkoutIn,
    WorkoutSummary,
)

router = APIRouter()
Db = Annotated[Connection, Depends(get_db)]

# no exercise is logged in more workouts than this; "no limit" in SQL terms
ALL = 2_147_483_647


def _exercise_or_404(conn: Connection, exercise_id: int) -> dict:
    exercise = repo.get_exercise(conn, exercise_id)
    if exercise is None:
        raise NotFoundError(f"Exercise {exercise_id} not found.")
    return exercise


def _check_name_free(conn: Connection, name: str, own_id: int | None = None) -> None:
    other = repo.get_exercise_by_name(conn, name)
    if other is not None and other["id"] != own_id:
        raise ConflictError(f"An exercise called '{name}' already exists.")


# ---------- exercises ----------


@router.post("/exercises", status_code=201, response_model=Exercise)
def create_exercise(body: ExerciseIn, conn: Db):
    _check_name_free(conn, body.name)
    new_id = repo.insert_exercise(conn, body.name, body.body_part, body.rep_range_min, body.rep_range_max)
    return repo.get_exercise(conn, new_id)


@router.get("/exercises", response_model=list[Exercise])
def list_exercises(conn: Db):
    return repo.list_exercises(conn)


@router.get("/exercises/{exercise_id}", response_model=Exercise)
def get_exercise(exercise_id: int, conn: Db):
    return _exercise_or_404(conn, exercise_id)


@router.put("/exercises/{exercise_id}", response_model=Exercise)
def replace_exercise(exercise_id: int, body: ExerciseIn, conn: Db):
    _exercise_or_404(conn, exercise_id)
    _check_name_free(conn, body.name, own_id=exercise_id)
    repo.update_exercise(conn, exercise_id, body.name, body.body_part, body.rep_range_min, body.rep_range_max)
    return repo.get_exercise(conn, exercise_id)


@router.delete("/exercises/{exercise_id}", status_code=204)
def delete_exercise(exercise_id: int, conn: Db):
    _exercise_or_404(conn, exercise_id)
    if repo.exercise_has_sets(conn, exercise_id):
        raise ConflictError("This exercise has logged sets. Delete those workouts first.")
    repo.delete_exercise(conn, exercise_id)
    return Response(status_code=204)


@router.get("/exercises/{exercise_id}/history", response_model=History)
def exercise_history(exercise_id: int, conn: Db, limit: Annotated[int | None, Query(ge=1, le=1000)] = None):
    exercise = _exercise_or_404(conn, exercise_id)
    sessions: dict[int, Session] = {}
    for row in repo.exercise_history(conn, exercise_id, limit or ALL):
        session = sessions.setdefault(
            row["workout_id"],
            Session(workout_id=row["workout_id"], performed_on=row["performed_on"], sets=[]),
        )
        session.sets.append(
            HistorySet(set_number=row["set_number"], weight_kg=row["weight_kg"], reps=row["reps"])
        )
    # dicts keep insertion order, and rows arrive newest first
    return History(exercise=exercise, sessions=list(sessions.values()))


# ---------- workouts ----------


def _save_sets(conn: Connection, workout_id: int, body: WorkoutIn) -> None:
    known = repo.existing_exercise_ids(conn)
    unknown = sorted({s.exercise_id for s in body.sets} - known)
    if unknown:
        raise InvalidInputError(f"Exercise {unknown[0]} does not exist.")
    numbers: Counter[int] = Counter()
    for s in body.sets:
        numbers[s.exercise_id] += 1
        repo.insert_set(conn, workout_id, s.exercise_id, numbers[s.exercise_id], s.weight_kg, s.reps)


def _workout(conn: Connection, workout_id: int) -> dict:
    workout = repo.get_workout(conn, workout_id)
    if workout is None:
        raise NotFoundError(f"Workout {workout_id} not found.")
    return {**workout, "sets": repo.list_sets(conn, workout_id)}


@router.post("/workouts", status_code=201, response_model=Workout)
def create_workout(body: WorkoutIn, conn: Db):
    workout_id = repo.insert_workout(conn, body.performed_on, body.notes)
    _save_sets(conn, workout_id, body)
    return _workout(conn, workout_id)


@router.get("/workouts", response_model=list[WorkoutSummary])
def list_workouts(
    conn: Db,
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
):
    return repo.list_workouts(conn, date_from, date_to)


@router.get("/workouts/{workout_id}", response_model=Workout)
def get_workout(workout_id: int, conn: Db):
    return _workout(conn, workout_id)


@router.put("/workouts/{workout_id}", response_model=Workout)
def replace_workout(workout_id: int, body: WorkoutIn, conn: Db):
    """Replace the date, notes and every set. The UI sends the whole workout."""
    if not repo.update_workout(conn, workout_id, body.performed_on, body.notes):
        raise NotFoundError(f"Workout {workout_id} not found.")
    repo.delete_sets(conn, workout_id)
    _save_sets(conn, workout_id, body)
    return _workout(conn, workout_id)


@router.delete("/workouts/{workout_id}", status_code=204)
def delete_workout(workout_id: int, conn: Db):
    if not repo.delete_workout(conn, workout_id):
        raise NotFoundError(f"Workout {workout_id} not found.")
    return Response(status_code=204)
