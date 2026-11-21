"""Read one exercise's full history from the workouts service, as a flat list of sets.

Used by goals (how close am I) and personal records. The contract is in docs/api.md:
GET /exercises/{id}/history. Workouts down or too slow -> the gateway raises a 503 error
with a readable message; an answer we cannot parse -> 502.
"""

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ValidationError

from app.errors import NotFoundError, UpstreamError
from app.gateway import WorkoutsGateway
from app.goals import LoggedSet


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


def fetch_sets(workouts: WorkoutsGateway, exercise_id: int, not_found: str) -> tuple[str, list[LoggedSet]]:
    """Return the exercise's name and every set ever logged for it.

    `not_found` is the message for a 404, so each caller can say what was missing.
    """
    try:
        raw = workouts.get_json(f"/exercises/{exercise_id}/history")
    except NotFoundError as e:
        raise NotFoundError(not_found) from e
    try:
        history = _History.model_validate(raw)
    except ValidationError as e:
        raise UpstreamError(f"the workouts service sent history we cannot use: {e}") from e

    sets = [
        LoggedSet(session.performed_on, s.weight_kg, s.reps)
        for session in history.sessions
        for s in session.sets
    ]
    return history.exercise.name, sets
