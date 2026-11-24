"""Request and response bodies. Validation lives here, so a bad request is a 422 before
any SQL runs. The JSON shapes are documented in docs/api.md."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

BodyPart = Literal["upper", "lower"]


class ExerciseIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    body_part: BodyPart
    rep_range_min: int = Field(ge=1, le=100)
    rep_range_max: int = Field(ge=1, le=100)

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v

    @model_validator(mode="after")
    def range_in_order(self):
        if self.rep_range_min > self.rep_range_max:
            raise ValueError("rep_range_min must be less than or equal to rep_range_max")
        return self


class Exercise(BaseModel):
    id: int
    name: str
    body_part: BodyPart
    rep_range_min: int
    rep_range_max: int


class SetIn(BaseModel):
    exercise_id: int
    weight_kg: float = Field(ge=0, le=1000)
    reps: int = Field(ge=1, le=1000)


class WorkoutIn(BaseModel):
    performed_on: date
    notes: str = Field(default="", max_length=500)
    # sets of one exercise are numbered in the order given here; a workout with no sets
    # would be an empty entry in the history, so at least one is required
    sets: list[SetIn] = Field(min_length=1, max_length=200)


class SetOut(BaseModel):
    exercise_id: int
    exercise_name: str
    set_number: int
    weight_kg: float
    reps: int


class Workout(BaseModel):
    id: int
    performed_on: date
    notes: str
    sets: list[SetOut]


class WorkoutSummary(BaseModel):
    id: int
    performed_on: date
    notes: str
    set_count: int


class HistorySet(BaseModel):
    set_number: int
    weight_kg: float
    reps: int


class Session(BaseModel):
    """One day of an exercise: every set of it logged on that date, in any workout."""

    performed_on: date
    workout_ids: list[int]
    sets: list[HistorySet]


class History(BaseModel):
    exercise: Exercise
    sessions: list[Session]
