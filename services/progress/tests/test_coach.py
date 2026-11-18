"""The double-progression rule, and the next-session endpoint with a fake workouts service."""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app import config
from app.coach import Action, PerformedSet, next_session
from app.errors import UpstreamUnavailableError
from app.main import create_app


def sets(weight, *reps):
    return [PerformedSet(Decimal(str(weight)), r) for r in reps]


# --- the rule --------------------------------------------------------------------------


def test_all_sets_at_top_of_range_adds_upper_body_increment():
    rec = next_session(sets(60, 12, 12, 12), 8, 12, "upper")
    assert (rec.action, rec.weight_kg, rec.target_reps, rec.sets) == (
        Action.INCREASE_WEIGHT,
        Decimal("62.5"),
        8,
        3,
    )


def test_lower_body_adds_five_kg():
    rec = next_session(sets(100, 10, 10), 6, 10, "lower")
    assert (rec.action, rec.weight_kg, rec.target_reps) == (Action.INCREASE_WEIGHT, Decimal(105), 6)


def test_reps_above_the_top_also_count_as_done():
    assert next_session(sets(60, 14, 12), 8, 12, "upper").action == Action.INCREASE_WEIGHT


def test_one_short_set_keeps_the_weight_and_adds_a_rep_to_the_weakest():
    rec = next_session(sets(60, 12, 11, 9), 8, 12, "upper")
    assert (rec.action, rec.weight_kg, rec.target_reps, rec.sets) == (
        Action.ADD_REPS,
        Decimal(60),
        10,
        3,
    )


def test_target_reps_never_exceed_the_top_of_the_range():
    # a set below the range but another at the top: aim for min+1, not above rep_max
    rec = next_session(sets(60, 12, 7), 8, 12, "upper")
    assert (rec.action, rec.target_reps) == (Action.ADD_REPS, 8)


def test_every_set_below_the_range_deloads_ten_percent_rounded_to_plates():
    rec = next_session(sets(83, 6, 5, 5), 8, 12, "upper")
    # 83 * 0.9 = 74.7 -> 72.5 (down to a multiple of 2.5 kg)
    assert (rec.action, rec.weight_kg, rec.target_reps) == (Action.DELOAD, Decimal("72.5"), 8)


def test_only_the_heaviest_sets_count_warmups_are_ignored():
    performed = sets(40, 12) + sets(60, 12, 12)
    rec = next_session(performed, 8, 12, "upper")
    assert (rec.weight_kg, rec.sets) == (Decimal("62.5"), 2)


def test_no_history_gives_no_numbers():
    rec = next_session([], 8, 12, "upper")
    assert rec.action == Action.NO_HISTORY
    assert (rec.weight_kg, rec.target_reps, rec.sets) == (None, None, None)
    assert "8 reps" in rec.reason


@pytest.mark.parametrize(("rep_min", "rep_max", "body"), [(0, 5, "upper"), (10, 8, "upper"), (8, 12, "core")])
def test_invalid_inputs_are_rejected(rep_min, rep_max, body):
    with pytest.raises(ValueError):
        next_session(sets(60, 10), rep_min, rep_max, body)


# --- the endpoint ----------------------------------------------------------------------

BENCH = {"id": 3, "name": "Bench press", "body_part": "upper", "rep_range_min": 8, "rep_range_max": 12}


class FakeWorkouts:
    def __init__(self, answer=None, error=None):
        self.answer, self.error, self.calls = answer, error, []

    def get_json(self, path, params=None):
        self.calls.append((path, params))
        if self.error:
            raise self.error
        return self.answer

    def close(self):
        pass


def client_with(fake):
    # no `with`: the lifespan (database) never runs, these tests need no SQL Server
    app = create_app(config.Settings(database_url="mssql://u:p@127.0.0.1:1/x", workouts_url="http://w"))
    app.state.workouts = fake
    return TestClient(app, raise_server_exceptions=False)


def test_endpoint_returns_the_recommendation_from_the_last_session():
    fake = FakeWorkouts(
        {
            "exercise": BENCH,
            "sessions": [
                {
                    "workout_id": 17,
                    "performed_on": "2026-11-17",
                    "sets": [{"set_number": n, "weight_kg": 60, "reps": 12} for n in (1, 2, 3)],
                }
            ],
        }
    )
    response = client_with(fake).get("/exercises/3/next-session")
    assert response.status_code == 200
    assert response.json() == {
        "exercise_id": 3,
        "exercise_name": "Bench press",
        "based_on": "2026-11-17",
        "action": "increase_weight",
        "weight_kg": 62.5,
        "target_reps": 8,
        "sets": 3,
        "reason": response.json()["reason"],
    }
    assert fake.calls == [("/exercises/3/history", {"limit": 1})]


def test_endpoint_with_no_sessions_says_so():
    response = client_with(FakeWorkouts({"exercise": BENCH, "sessions": []})).get("/exercises/3/next-session")
    assert response.status_code == 200
    assert response.json()["action"] == "no_history"
    assert response.json()["based_on"] is None


def test_endpoint_502_when_workouts_sends_something_unusable():
    response = client_with(FakeWorkouts({"exercise": {"id": 3}})).get("/exercises/3/next-session")
    assert response.status_code == 502
    assert "cannot use" in response.json()["detail"]


def test_endpoint_502_when_workouts_sends_a_bad_rep_range():
    bad = {**BENCH, "rep_range_min": 12, "rep_range_max": 8}
    response = client_with(FakeWorkouts({"exercise": bad, "sessions": []})).get("/exercises/3/next-session")
    assert response.status_code == 502


def test_endpoint_503_with_a_readable_message_when_workouts_is_down():
    fake = FakeWorkouts(error=UpstreamUnavailableError("The workouts service is unavailable right now."))
    response = client_with(fake).get("/exercises/3/next-session")
    assert response.status_code == 503
    assert response.json() == {"detail": "The workouts service is unavailable right now."}
