"""The next-session coach: double progression, as a pure function.

Double progression is the standard rule for hypertrophy training with a rep range
(e.g. 8-12): keep the weight and add reps until every set reaches the top of the range,
then add weight and start again at the bottom. This module only does that arithmetic;
fetching the history (gateway) and HTTP (coach_api) live elsewhere, so the rule is tested
without a network or a database.

Rules, applied to the heaviest weight of the last session (the "working sets"):
- every working set hit the top of the range -> add weight, aim for the bottom of the range
- every working set fell short of the bottom -> deload 10% (rounded down to 2.5 kg)
- otherwise -> same weight, one more rep than the weakest working set (capped at the top)
"""

from dataclasses import dataclass
from decimal import ROUND_FLOOR, Decimal
from enum import StrEnum

# smallest plate pair in most gyms is 2 x 1.25 kg
PLATE_STEP = Decimal("2.5")
INCREMENT = {"upper": Decimal("2.5"), "lower": Decimal("5")}
DELOAD = Decimal("0.9")


class Action(StrEnum):
    INCREASE_WEIGHT = "increase_weight"
    ADD_REPS = "add_reps"
    DELOAD = "deload"
    NO_HISTORY = "no_history"


@dataclass(frozen=True)
class PerformedSet:
    weight_kg: Decimal
    reps: int


@dataclass(frozen=True)
class Recommendation:
    action: Action
    weight_kg: Decimal | None
    target_reps: int | None
    sets: int | None
    reason: str


def _round_down_to_plates(weight: Decimal) -> Decimal:
    return (weight / PLATE_STEP).to_integral_value(rounding=ROUND_FLOOR) * PLATE_STEP


def next_session(last_sets: list[PerformedSet], rep_min: int, rep_max: int, body_part: str) -> Recommendation:
    if not 1 <= rep_min <= rep_max:
        raise ValueError(f"invalid rep range {rep_min}-{rep_max}")
    if body_part not in INCREMENT:
        raise ValueError(f"unknown body part {body_part!r}")
    if not last_sets:
        return Recommendation(
            Action.NO_HISTORY,
            None,
            None,
            None,
            "No sessions logged for this exercise yet. Pick a weight you can lift "
            f"for {rep_min} reps and log it.",
        )

    weight = max(s.weight_kg for s in last_sets)
    working = [s.reps for s in last_sets if s.weight_kg == weight]
    sets = len(working)

    if min(working) >= rep_max:
        new_weight = weight + INCREMENT[body_part]
        return Recommendation(
            Action.INCREASE_WEIGHT,
            new_weight,
            rep_min,
            sets,
            f"Every set at {weight} kg reached {rep_max} reps. Add weight and start again at {rep_min} reps.",
        )

    if max(working) < rep_min:
        # never below the lightest plate step (or the current weight, if already lighter)
        new_weight = max(_round_down_to_plates(weight * DELOAD), min(weight, PLATE_STEP))
        return Recommendation(
            Action.DELOAD,
            new_weight,
            rep_min,
            sets,
            f"No set at {weight} kg reached {rep_min} reps. Drop about 10% and build back up.",
        )

    target = min(min(working) + 1, rep_max)
    return Recommendation(
        Action.ADD_REPS,
        weight,
        target,
        sets,
        f"Stay at {weight} kg and aim for {target} reps on every set.",
    )
