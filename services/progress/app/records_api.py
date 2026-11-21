"""Personal records over HTTP (#20).

GET /exercises/{id}/records reads the exercise's full history from the workouts service,
works out the PRs (app/records.py), saves them in the progress database and returns them,
marking the ones that are new since the last check. It answers 503 with a readable
message while workouts is down, like the coach and goal progress.

GET /records lists the PRs saved at the last check of each exercise. It only uses the
progress database, so the PR board still shows something while workouts is down.
"""

from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel

from app import records_repository as repo
from app.db import Connection, get_db
from app.history import fetch_sets
from app.records import is_new, personal_records

router = APIRouter()
Db = Annotated[Connection, Depends(get_db)]


class Record(BaseModel):
    reps: int
    weight_kg: float
    achieved_on: date


class FreshRecord(Record):
    new: bool  # beats what was stored at the last check, so the UI can celebrate it


class ExerciseRecords(BaseModel):
    exercise_id: int
    exercise_name: str
    records: list[FreshRecord]


class StoredRecord(Record):
    exercise_id: int


@router.get("/exercises/{exercise_id}/records", response_model=ExerciseRecords)
def get_exercise_records(exercise_id: int, request: Request, conn: Db) -> ExerciseRecords:
    exercise_name, sets = fetch_sets(
        request.app.state.workouts, exercise_id, f"Exercise {exercise_id} not found."
    )
    records = personal_records(sets)

    previous = {r["reps"]: Decimal(r["weight_kg"]) for r in repo.list_records(conn, exercise_id)}
    # replace, not merge: a deleted or corrected workout must also correct its PRs
    repo.delete_records(conn, exercise_id)
    for r in records:
        repo.insert_record(conn, exercise_id, r.reps, r.weight_kg, r.achieved_on)

    return ExerciseRecords(
        exercise_id=exercise_id,
        exercise_name=exercise_name,
        records=[
            FreshRecord(
                reps=r.reps,
                weight_kg=float(r.weight_kg),
                achieved_on=r.achieved_on,
                new=is_new(r, previous),
            )
            for r in records
        ],
    )


@router.get("/records", response_model=list[StoredRecord])
def list_stored_records(conn: Db, exercise_id: Annotated[int | None, Query(ge=1)] = None):
    return repo.list_records(conn, exercise_id)
