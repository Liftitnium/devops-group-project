"""Exercises, workouts and history, end to end over HTTP against a real SQL Server."""

import pytest

BENCH = {"name": "Bench press", "body_part": "upper", "rep_range_min": 8, "rep_range_max": 12}
SQUAT = {"name": "Squat", "body_part": "lower", "rep_range_min": 5, "rep_range_max": 8}


def make_exercise(client, **overrides):
    response = client.post("/exercises", json={**BENCH, **overrides})
    assert response.status_code == 201, response.text
    return response.json()


def log_workout(client, performed_on, sets, notes=""):
    response = client.post("/workouts", json={"performed_on": performed_on, "notes": notes, "sets": sets})
    assert response.status_code == 201, response.text
    return response.json()


# ---------- exercises (#9) ----------


def test_exercise_crud_round_trip(client):
    created = make_exercise(client, name="  Bench press  ")
    assert created == {"id": created["id"], **BENCH}  # name is trimmed

    assert client.get(f"/exercises/{created['id']}").json() == created
    make_exercise(client, **SQUAT)
    assert [e["name"] for e in client.get("/exercises").json()] == ["Bench press", "Squat"]

    updated = client.put(f"/exercises/{created['id']}", json={**BENCH, "rep_range_max": 10})
    assert updated.status_code == 200
    assert updated.json()["rep_range_max"] == 10

    assert client.delete(f"/exercises/{created['id']}").status_code == 204
    assert client.get(f"/exercises/{created['id']}").status_code == 404


def test_rep_range_out_of_order_is_422_with_a_readable_message(client):
    response = client.post("/exercises", json={**BENCH, "rep_range_min": 12, "rep_range_max": 8})
    assert response.status_code == 422
    assert response.json() == {"detail": "rep_range_min must be less than or equal to rep_range_max"}


@pytest.mark.parametrize(
    ("field", "value"),
    [("body_part", "core"), ("name", "   "), ("rep_range_min", 0), ("name", "x" * 101)],
)
def test_invalid_exercise_fields_are_422_naming_the_field(client, field, value):
    response = client.post("/exercises", json={**BENCH, field: value})
    assert response.status_code == 422
    assert response.json()["detail"].startswith(field)


def test_duplicate_exercise_name_is_409(client):
    make_exercise(client)
    response = client.post("/exercises", json=BENCH)
    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]


def test_renaming_onto_another_exercise_is_409_but_keeping_own_name_is_fine(client):
    bench = make_exercise(client)
    make_exercise(client, **SQUAT)
    assert client.put(f"/exercises/{bench['id']}", json={**BENCH, "rep_range_min": 6}).status_code == 200
    assert client.put(f"/exercises/{bench['id']}", json={**BENCH, "name": "Squat"}).status_code == 409


def test_missing_exercise_is_404_on_every_route(client):
    assert client.get("/exercises/999").json() == {"detail": "Exercise 999 not found."}
    assert client.put("/exercises/999", json=BENCH).status_code == 404
    assert client.delete("/exercises/999").status_code == 404
    assert client.get("/exercises/999/history").status_code == 404


def test_exercise_with_logged_sets_cannot_be_deleted(client):
    bench = make_exercise(client)
    log_workout(client, "2026-11-17", [{"exercise_id": bench["id"], "weight_kg": 60, "reps": 10}])
    response = client.delete(f"/exercises/{bench['id']}")
    assert response.status_code == 409
    assert "Delete those workouts first" in response.json()["detail"]


# ---------- workouts and sets (#10) ----------


def test_workout_with_sets_is_saved_and_sets_are_numbered_per_exercise(client):
    bench, squat = make_exercise(client), make_exercise(client, **SQUAT)
    workout = log_workout(
        client,
        "2026-11-17",
        [
            {"exercise_id": squat["id"], "weight_kg": 100, "reps": 5},
            {"exercise_id": bench["id"], "weight_kg": 60, "reps": 12},
            {"exercise_id": squat["id"], "weight_kg": 100, "reps": 5},
            {"exercise_id": bench["id"], "weight_kg": 62.5, "reps": 10},
        ],
        notes="leg day-ish",
    )
    assert workout["performed_on"] == "2026-11-17"
    assert workout["notes"] == "leg day-ish"
    assert [(s["exercise_name"], s["set_number"], s["weight_kg"], s["reps"]) for s in workout["sets"]] == [
        ("Squat", 1, 100.0, 5),
        ("Bench press", 1, 60.0, 12),
        ("Squat", 2, 100.0, 5),
        ("Bench press", 2, 62.5, 10),
    ]
    assert client.get(f"/workouts/{workout['id']}").json() == workout


def test_list_workouts_newest_first_with_set_counts_and_date_filter(client):
    bench = make_exercise(client)
    one_set = [{"exercise_id": bench["id"], "weight_kg": 60, "reps": 10}]
    old = log_workout(client, "2026-11-10", one_set)
    new = log_workout(client, "2026-11-17", one_set * 3)

    listed = client.get("/workouts").json()
    assert [(w["id"], w["set_count"]) for w in listed] == [(new["id"], 3), (old["id"], 1)]
    assert [w["id"] for w in client.get("/workouts", params={"from": "2026-11-15"}).json()] == [new["id"]]
    assert [w["id"] for w in client.get("/workouts", params={"to": "2026-11-15"}).json()] == [old["id"]]


def test_replacing_a_workout_replaces_its_sets(client):
    bench = make_exercise(client)
    workout = log_workout(
        client, "2026-11-17", [{"exercise_id": bench["id"], "weight_kg": 60, "reps": 10}] * 3
    )
    response = client.put(
        f"/workouts/{workout['id']}",
        json={
            "performed_on": "2026-11-18",
            "notes": "fixed",
            "sets": [{"exercise_id": bench["id"], "weight_kg": 65, "reps": 8}],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert (body["performed_on"], body["notes"], len(body["sets"])) == ("2026-11-18", "fixed", 1)


def test_deleting_a_workout_deletes_its_sets(client):
    bench = make_exercise(client)
    workout = log_workout(client, "2026-11-17", [{"exercise_id": bench["id"], "weight_kg": 60, "reps": 10}])
    assert client.delete(f"/workouts/{workout['id']}").status_code == 204
    assert client.get(f"/workouts/{workout['id']}").status_code == 404
    # no sets left, so the exercise can now be deleted
    assert client.delete(f"/exercises/{bench['id']}").status_code == 204


def test_missing_workout_is_404(client):
    assert client.get("/workouts/999").json() == {"detail": "Workout 999 not found."}
    bench = make_exercise(client)
    one_set = [{"exercise_id": bench["id"], "weight_kg": 60, "reps": 10}]
    missing = client.put("/workouts/999", json={"performed_on": "2026-11-17", "sets": one_set})
    assert missing.status_code == 404
    assert client.delete("/workouts/999").status_code == 404


def test_set_with_unknown_exercise_is_422_and_nothing_is_saved(client):
    response = client.post(
        "/workouts",
        json={"performed_on": "2026-11-17", "sets": [{"exercise_id": 999, "weight_kg": 60, "reps": 5}]},
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "Exercise 999 does not exist."}
    assert client.get("/workouts").json() == []


@pytest.mark.parametrize("body", [{"performed_on": "2026-11-17"}, {"performed_on": "2026-11-17", "sets": []}])
def test_workout_without_sets_is_422_and_nothing_is_saved(client, body):
    response = client.post("/workouts", json=body)
    assert response.status_code == 422
    assert "sets" in response.json()["detail"]
    assert client.get("/workouts").json() == []


def test_failed_replace_keeps_the_old_workout_and_its_sets(client):
    bench = make_exercise(client)
    two_sets = [{"exercise_id": bench["id"], "weight_kg": 60, "reps": 10}] * 2
    workout = log_workout(client, "2026-11-17", two_sets)
    # the second set names an exercise that doesn't exist, so the whole replace is rolled back
    response = client.put(
        f"/workouts/{workout['id']}",
        json={
            "performed_on": "2026-11-18",
            "notes": "should not stick",
            "sets": [
                {"exercise_id": bench["id"], "weight_kg": 65, "reps": 8},
                {"exercise_id": 999, "weight_kg": 65, "reps": 8},
            ],
        },
    )
    assert response.status_code == 422
    assert client.get(f"/workouts/{workout['id']}").json() == workout


@pytest.mark.parametrize(("field", "value"), [("weight_kg", -1), ("reps", 0)])
def test_negative_weight_and_zero_reps_are_422(client, field, value):
    bench = make_exercise(client)
    bad_set = {"exercise_id": bench["id"], "weight_kg": 60, "reps": 5, field: value}
    response = client.post("/workouts", json={"performed_on": "2026-11-17", "sets": [bad_set]})
    assert response.status_code == 422
    assert field in response.json()["detail"]


# ---------- history (#11), the contract in docs/api.md ----------


def test_history_matches_the_contract_newest_first_and_only_this_exercise(client):
    bench, squat = make_exercise(client), make_exercise(client, **SQUAT)
    first = log_workout(client, "2026-11-10", [{"exercise_id": bench["id"], "weight_kg": 60, "reps": 10}])
    log_workout(client, "2026-11-12", [{"exercise_id": squat["id"], "weight_kg": 100, "reps": 5}])
    last = log_workout(
        client,
        "2026-11-17",
        [
            {"exercise_id": bench["id"], "weight_kg": 60, "reps": 12},
            {"exercise_id": squat["id"], "weight_kg": 100, "reps": 5},
            {"exercise_id": bench["id"], "weight_kg": 60, "reps": 11},
        ],
    )

    response = client.get(f"/exercises/{bench['id']}/history")
    assert response.status_code == 200
    assert response.json() == {
        "exercise": {"id": bench["id"], **BENCH},
        "sessions": [
            {
                "workout_id": last["id"],
                "performed_on": "2026-11-17",
                "sets": [
                    {"set_number": 1, "weight_kg": 60.0, "reps": 12},
                    {"set_number": 2, "weight_kg": 60.0, "reps": 11},
                ],
            },
            {
                "workout_id": first["id"],
                "performed_on": "2026-11-10",
                "sets": [{"set_number": 1, "weight_kg": 60.0, "reps": 10}],
            },
        ],
    }

    limited = client.get(f"/exercises/{bench['id']}/history", params={"limit": 1}).json()
    assert [s["workout_id"] for s in limited["sessions"]] == [last["id"]]


def test_history_of_an_unused_exercise_has_no_sessions(client):
    bench = make_exercise(client)
    assert client.get(f"/exercises/{bench['id']}/history").json()["sessions"] == []


def test_history_limit_must_be_positive(client):
    bench = make_exercise(client)
    assert client.get(f"/exercises/{bench['id']}/history", params={"limit": 0}).status_code == 422
