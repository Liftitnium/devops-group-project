"""How close a goal is, as a pure function.

A goal is "lift target_weight_kg for at least target_reps reps". The best attempt so far is
the heaviest set of that exercise done for at least target_reps reps: 62.5 kg x 10 counts
towards a 60 kg x 8 goal, 70 kg x 5 does not. This module only does that arithmetic;
reading the goal (goals_repository) and the history (gateway) live elsewhere, so the rule
is tested without a network or a database.
"""

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal


@dataclass(frozen=True)
class LoggedSet:
    performed_on: date
    weight_kg: Decimal
    reps: int


@dataclass(frozen=True)
class GoalProgress:
    best_weight_kg: Decimal | None  # heaviest qualifying set, None if there is none yet
    best_on: date | None
    percent: int  # best / target, 0-100
    achieved: bool
    days_left: int  # negative once the target date has passed


def goal_progress(
    target_weight_kg: Decimal, target_reps: int, target_date: date, sets: list[LoggedSet], today: date
) -> GoalProgress:
    if target_weight_kg <= 0 or target_reps < 1:
        raise ValueError("a goal needs a positive weight and at least one rep")

    qualifying = [s for s in sets if s.reps >= target_reps]
    # heaviest first; on a tie, the earliest date is when it was first reached
    best = max(qualifying, key=lambda s: (s.weight_kg, -s.performed_on.toordinal()), default=None)

    if best is None:
        percent = 0
    else:
        ratio = best.weight_kg / target_weight_kg * 100
        percent = min(100, int(ratio.to_integral_value(rounding=ROUND_HALF_UP)))

    return GoalProgress(
        best_weight_kg=best.weight_kg if best else None,
        best_on=best.performed_on if best else None,
        percent=percent,
        achieved=best is not None and best.weight_kg >= target_weight_kg,
        days_left=(target_date - today).days,
    )
