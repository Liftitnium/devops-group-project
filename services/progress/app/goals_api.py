"""Goals over HTTP (#21): full CRUD in the progress database, plus how close each goal is.

CRUD only needs this service's own database, so it keeps working when the workouts
service is down, except for checking exercise_id on create and update. The progress
endpoint reads the exercise history from workouts (contract in docs/api.md) and answers
503 with a readable message when workouts is down, like the coach does.
"""

from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field, ValidationError

from app import goals_repository as repo
from app.db import Connection, get_db
from app.errors import InvalidInputError, NotFoundError, UpstreamError
from app.goals import LoggedSet, goal_progress

router = APIRouter()
Db = Annotated[Connection, Depends(get_db)]


# ---------- request and response bodies ----------


class GoalIn(BaseModel):
    exercise_id: int = Field(ge=1)
    target_weight_kg: Decimal = Field(gt=0, le=1000, decimal_places=2)
    target_reps: int = Field(ge=1, le=100)
    target_date: date


class Goal(BaseModel):
    id: int
    exercise_id: int
    target_weight_kg: float
    target_reps: int
    target_date: date


class GoalProgressOut(BaseModel):
    goal: Goal
    exercise_name: str
    best_weight_kg: float | None
    best_on: date | None
    percent: int
    achieved: bool
    days_left: int


# what we read from workouts: GET /exercises/{id}/history (contract in docs/api.md)
class _Exercise(BaseModel):
    id: int
    name: str


class _Set(BaseModel):
    weight_kg: Decimal
    reps: int


class _Session(BaseModel):
    performed_on: date
    sets: list[_Set]


class _History(BaseModel):
    exercise: _Exercise
    sessions: list[_Session]


# ---------- helpers ----------


def _goal_or_404(conn: Connection, goal_id: int) -> dict:
    goal = repo.get_goal(conn, goal_id)
    if goal is None:
        raise NotFoundError(f"Goal {goal_id} not found.")
    return goal


def _check_exercise_exists(request: Request, exercise_id: int) -> None:
    """Ask workouts whether the exercise exists. Workouts down -> 503 from the gateway."""
    try:
        request.app.state.workouts.get_json(f"/exercises/{exercise_id}")
    except NotFoundError as e:
        raise InvalidInputError(f"Exercise {exercise_id} does not exist.") from e


# ---------- CRUD ----------


@router.post("/goals", status_code=201, response_model=Goal)
def create_goal(body: GoalIn, request: Request, conn: Db):
    if body.target_date < date.today():
        raise InvalidInputError("target_date must be today or later.")
    _check_exercise_exists(request, body.exercise_id)
    new_id = repo.insert_goal(
        conn, body.exercise_id, body.target_weight_kg, body.target_reps, body.target_date
    )
    return repo.get_goal(conn, new_id)


@router.get("/goals", response_model=list[Goal])
def list_goals(conn: Db, exercise_id: Annotated[int | None, Query(ge=1)] = None):
    return repo.list_goals(conn, exercise_id)


@router.get("/goals/{goal_id}", response_model=Goal)
def get_goal(goal_id: int, conn: Db):
    return _goal_or_404(conn, goal_id)


@router.put("/goals/{goal_id}", response_model=Goal)
def replace_goal(goal_id: int, body: GoalIn, request: Request, conn: Db):
    """Replace every field. A past target_date is allowed here, to fix an old goal."""
    current = _goal_or_404(conn, goal_id)
    if body.exercise_id != current["exercise_id"]:
        _check_exercise_exists(request, body.exercise_id)
    repo.update_goal(
        conn, goal_id, body.exercise_id, body.target_weight_kg, body.target_reps, body.target_date
    )
    return repo.get_goal(conn, goal_id)


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: int, conn: Db):
    if not repo.delete_goal(conn, goal_id):
        raise NotFoundError(f"Goal {goal_id} not found.")
    return Response(status_code=204)


# ---------- how close am I ----------


@router.get("/goals/{goal_id}/progress", response_model=GoalProgressOut)
def get_goal_progress(goal_id: int, request: Request, conn: Db):
    goal = _goal_or_404(conn, goal_id)
    try:
        raw = request.app.state.workouts.get_json(f"/exercises/{goal['exercise_id']}/history")
    except NotFoundError as e:
        raise NotFoundError(
            f"Exercise {goal['exercise_id']} of this goal no longer exists in the workouts service."
        ) from e
    try:
        history = _History.model_validate(raw)
    except ValidationError as e:
        raise UpstreamError(f"the workouts service sent history we cannot use: {e}") from e

    sets = [
        LoggedSet(session.performed_on, s.weight_kg, s.reps)
        for session in history.sessions
        for s in session.sets
    ]
    progress = goal_progress(
        Decimal(goal["target_weight_kg"]), goal["target_reps"], goal["target_date"], sets, date.today()
    )
    return GoalProgressOut(
        goal=Goal.model_validate(goal),
        exercise_name=history.exercise.name,
        best_weight_kg=float(progress.best_weight_kg) if progress.best_weight_kg is not None else None,
        best_on=progress.best_on,
        percent=progress.percent,
        achieved=progress.achieved,
        days_left=progress.days_left,
    )
