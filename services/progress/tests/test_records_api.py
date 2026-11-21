"""Personal records (#20) end to end over HTTP against a real SQL Server, with a fake
workouts service."""

import pytest
from fastapi.testclient import TestClient

from app.errors import NotFoundError, UpstreamUnavailableError
from app.main import create_app

BENCH = {"id": 3, "name": "Bench press", "body_part": "upper", "rep_range_min": 8, "rep_range_max": 12}


def session(workout_id, day, *sets):
    return {
        "workout_id": workout_id,
        "performed_on": day,
        "sets": [{"set_number": i + 1, "weight_kg": w, "reps": r} for i, (w, r) in enumerate(sets)],
    }


class FakeWorkouts:
    """Stands in for the workouts service: knows exercise 3 and its history, or is down."""

    def __init__(self):
        self.down = False
        self.sessions = []

    def get_json(self, path, params=None):
        if self.down:
            raise UpstreamUnavailableError(
                "The workouts service is unavailable right now. Try again shortly."
            )
        if path == "/exercises/3/history":
            return {"exercise": BENCH, "sessions": self.sessions}
        raise NotFoundError("not found in the workouts service")

    def close(self):
        pass


@pytest.fixture
def workouts():
    return FakeWorkouts()


@pytest.fixture
def client(settings, workouts):
    app = create_app(settings)
    app.state.workouts = workouts
    with TestClient(app) as c:
        yield c


def test_records_are_the_heaviest_set_per_rep_count(client, workouts):
    workouts.sessions = [
        session(2, "2026-11-17", (62.5, 8), (70, 5)),
        session(1, "2026-11-12", (60, 8), (60, 8), (50, 12)),
    ]
    body = client.get("/exercises/3/records").json()
    assert body["exercise_name"] == "Bench press"
    assert [(r["reps"], r["weight_kg"], r["achieved_on"]) for r in body["records"]] == [
        (5, 70.0, "2026-11-17"),
        (8, 62.5, "2026-11-17"),
        (12, 50.0, "2026-11-12"),
    ]


def test_no_history_gives_an_empty_list(client):
    assert client.get("/exercises/3/records").json()["records"] == []


def test_new_marks_only_records_beaten_since_the_last_check(client, workouts):
    workouts.sessions = [session(1, "2026-11-12", (60, 8), (70, 5))]
    assert all(r["new"] for r in client.get("/exercises/3/records").json()["records"])

    workouts.sessions.insert(0, session(2, "2026-11-17", (62.5, 8), (65, 5)))
    records = client.get("/exercises/3/records").json()["records"]
    assert {r["reps"]: r["new"] for r in records} == {5: False, 8: True}


def test_records_are_saved_and_follow_a_deleted_workout(client, workouts):
    workouts.sessions = [session(2, "2026-11-17", (62.5, 8)), session(1, "2026-11-12", (60, 8))]
    client.get("/exercises/3/records")
    assert client.get("/records").json() == [
        {"exercise_id": 3, "reps": 8, "weight_kg": 62.5, "achieved_on": "2026-11-17"}
    ]

    workouts.sessions = workouts.sessions[1:]  # the 62.5 kg workout was deleted
    client.get("/exercises/3/records")
    assert client.get("/records", params={"exercise_id": 3}).json()[0]["weight_kg"] == 60.0


def test_unknown_exercise_is_404(client):
    response = client.get("/exercises/999/records")
    assert response.status_code == 404
    assert response.json() == {"detail": "Exercise 999 not found."}


def test_workouts_down_is_503_with_a_readable_message(client, workouts):
    workouts.down = True
    response = client.get("/exercises/3/records")
    assert response.status_code == 503
    assert "unavailable" in response.json()["detail"]


def test_saved_records_still_list_while_workouts_is_down(client, workouts):
    workouts.sessions = [session(1, "2026-11-12", (60, 8))]
    client.get("/exercises/3/records")
    workouts.down = True
    response = client.get("/records")
    assert response.status_code == 200
    assert len(response.json()) == 1


def test_history_with_the_wrong_shape_is_502(client, workouts):
    workouts.sessions = [{"performed_on": "not a date", "sets": []}]
    assert client.get("/exercises/3/records").status_code == 502
