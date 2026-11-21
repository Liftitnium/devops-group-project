"""Personal records (#20), as pure functions.

A personal record (PR) is the heaviest weight ever lifted for an exact rep count on one
exercise: your 1-rep PR, your 5-rep PR, your 8-rep PR, and so on. If the same weight was
reached on several days, the record keeps the first day. This module only does that
arithmetic; reading the history (history.py) and storing the result
(records_repository.py) live elsewhere, so the rule is tested without a network or a
database.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.goals import LoggedSet


@dataclass(frozen=True)
class PersonalRecord:
    reps: int
    weight_kg: Decimal
    achieved_on: date


def personal_records(sets: list[LoggedSet]) -> list[PersonalRecord]:
    """The heaviest set for each rep count, ordered by reps (fewest first)."""
    best: dict[int, LoggedSet] = {}
    for s in sets:
        current = best.get(s.reps)
        heavier = current is None or s.weight_kg > current.weight_kg
        same_but_earlier = (
            current is not None and s.weight_kg == current.weight_kg and s.performed_on < current.performed_on
        )
        if heavier or same_but_earlier:
            best[s.reps] = s
    return [PersonalRecord(reps, s.weight_kg, s.performed_on) for reps, s in sorted(best.items())]


def is_new(record: PersonalRecord, previous: dict[int, Decimal]) -> bool:
    """True when this PR beats what was stored at the last check (or there was none)."""
    before = previous.get(record.reps)
    return before is None or record.weight_kg > before
