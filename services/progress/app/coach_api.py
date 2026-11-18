"""GET /exercises/{exercise_id}/next-session: the coach over HTTP.

Reads the exercise and its last session from the workouts service in one call
(contract in docs/api.md), validates the answer, and applies app.coach.next_session.
Nothing is stored: a recommendation is always recomputed from the latest history.
"""

from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ValidationError

from app.coach import Action, PerformedSet, next_session
from app.errors import UpstreamError

router = APIRouter()


# what we expect from workouts: GET /exercises/{id}/history?limit=1
class _Exercise(BaseModel):
    id: int
    name: str
    body_part: Literal["upper", "lower"]
    rep_range_min: int
    rep_range_max: int


class _Set(BaseModel):
    weight_kg: Decimal
    reps: int


class _Session(BaseModel):
    performed_on: date
    sets: list[_Set]


class _History(BaseModel):
    exercise: _Exercise
    sessions: list[_Session]  # newest first


class NextSession(BaseModel):
    exercise_id: int
    exercise_name: str
    based_on: date | None
    action: Action
    weight_kg: float | None
    target_reps: int | None
    sets: int | None
    reason: str


@router.get("/exercises/{exercise_id}/next-session", response_model=NextSession)
def get_next_session(exercise_id: int, request: Request) -> NextSession:
    raw = request.app.state.workouts.get_json(f"/exercises/{exercise_id}/history", {"limit": 1})
    try:
        history = _History.model_validate(raw)
        last = history.sessions[0] if history.sessions else None
        rec = next_session(
            [PerformedSet(s.weight_kg, s.reps) for s in (last.sets if last else [])],
            history.exercise.rep_range_min,
            history.exercise.rep_range_max,
            history.exercise.body_part,
        )
    except (ValidationError, ValueError) as e:
        raise UpstreamError(f"the workouts service sent history we cannot use: {e}") from e

    return NextSession(
        exercise_id=history.exercise.id,
        exercise_name=history.exercise.name,
        based_on=last.performed_on if last else None,
        action=rec.action,
        weight_kg=float(rec.weight_kg) if rec.weight_kg is not None else None,
        target_reps=rec.target_reps,
        sets=rec.sets,
        reason=rec.reason,
    )
