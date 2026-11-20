"""The "how close am I" rule for goals, as a pure function: no database, no network."""

from datetime import date
from decimal import Decimal

import pytest

from app.goals import LoggedSet, goal_progress

TODAY = date(2026, 11, 19)
DEADLINE = date(2026, 12, 19)


def s(day: int, weight: str, reps: int) -> LoggedSet:
    return LoggedSet(date(2026, 11, day), Decimal(weight), reps)


def progress(sets, weight="60", reps=8, target_date=DEADLINE):
    return goal_progress(Decimal(weight), reps, target_date, sets, TODAY)


def test_no_history_is_zero_percent_not_achieved():
    p = progress([])
    assert (p.best_weight_kg, p.best_on, p.percent, p.achieved) == (None, None, 0, False)
    assert p.days_left == 30


def test_best_is_heaviest_set_with_enough_reps():
    p = progress([s(10, "50", 10), s(12, "55", 8), s(14, "70", 5)])  # 70 x 5 has too few reps
    assert (p.best_weight_kg, p.best_on) == (Decimal("55"), date(2026, 11, 12))
    assert p.percent == 92  # 55 / 60
    assert not p.achieved


def test_more_reps_than_the_target_still_counts():
    p = progress([s(15, "62.5", 10)])
    assert p.achieved
    assert p.percent == 100  # capped, even above the target


def test_exactly_the_target_is_achieved():
    assert progress([s(15, "60", 8)]).achieved


def test_tie_reports_the_first_day_it_was_reached():
    assert progress([s(17, "57.5", 8), s(11, "57.5", 9)]).best_on == date(2026, 11, 11)


def test_days_left_goes_negative_after_the_deadline():
    assert progress([], target_date=date(2026, 11, 16)).days_left == -3


@pytest.mark.parametrize(("weight", "reps"), [("0", 8), ("60", 0)])
def test_impossible_goal_is_rejected(weight, reps):
    with pytest.raises(ValueError):
        progress([], weight=weight, reps=reps)
