"""The personal-record rule, as pure functions: no database, no network."""

from datetime import date
from decimal import Decimal

from app.goals import LoggedSet
from app.records import PersonalRecord, is_new, personal_records


def s(day: int, weight: str, reps: int) -> LoggedSet:
    return LoggedSet(date(2026, 11, day), Decimal(weight), reps)


def test_no_history_means_no_records():
    assert personal_records([]) == []


def test_heaviest_weight_for_each_rep_count_ordered_by_reps():
    records = personal_records(
        [s(10, "60", 8), s(12, "62.5", 8), s(12, "70", 5), s(14, "65", 5), s(15, "50", 12)]
    )
    assert records == [
        PersonalRecord(5, Decimal("70"), date(2026, 11, 12)),
        PersonalRecord(8, Decimal("62.5"), date(2026, 11, 12)),
        PersonalRecord(12, Decimal("50"), date(2026, 11, 15)),
    ]


def test_rep_counts_are_exact_not_at_least():
    # 60 x 10 is a 10-rep PR; it does not also count as the 8-rep PR
    assert [r.reps for r in personal_records([s(10, "60", 10), s(11, "55", 8)])] == [8, 10]


def test_same_weight_again_keeps_the_first_day():
    assert personal_records([s(17, "60", 8), s(11, "60", 8)])[0].achieved_on == date(2026, 11, 11)


def test_new_when_heavier_than_last_check_or_never_seen():
    record = PersonalRecord(8, Decimal("62.5"), date(2026, 11, 17))
    assert is_new(record, {})
    assert is_new(record, {8: Decimal("60")})
    assert not is_new(record, {8: Decimal("62.5")})
    assert is_new(record, {5: Decimal("80")})
