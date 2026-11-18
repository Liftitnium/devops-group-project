// Sample data in the shapes the services return (docs/workouts-api.md, docs/api.md), so the
// page can be built before it is wired to the APIs. Removed once every section reads from
// the services (#13–#16).
window.SAMPLE = {
  // GET /exercises
  exercises: [
    { id: 1, name: "Bench press", body_part: "upper", rep_range_min: 8, rep_range_max: 12 },
    { id: 2, name: "Romanian deadlift", body_part: "lower", rep_range_min: 6, rep_range_max: 10 },
    { id: 3, name: "Squat", body_part: "lower", rep_range_min: 5, rep_range_max: 8 },
  ],

  // GET /workouts/{id} for each workout (GET /workouts returns set_count instead of sets)
  workouts: [
    {
      id: 3, performed_on: "2026-11-17", notes: "felt strong",
      sets: [
        { exercise_id: 1, exercise_name: "Bench press", set_number: 1, weight_kg: 60, reps: 12 },
        { exercise_id: 1, exercise_name: "Bench press", set_number: 2, weight_kg: 60, reps: 12 },
        { exercise_id: 1, exercise_name: "Bench press", set_number: 3, weight_kg: 60, reps: 12 },
        { exercise_id: 2, exercise_name: "Romanian deadlift", set_number: 1, weight_kg: 80, reps: 9 },
        { exercise_id: 2, exercise_name: "Romanian deadlift", set_number: 2, weight_kg: 80, reps: 8 },
      ],
    },
    {
      id: 2, performed_on: "2026-11-14", notes: "",
      sets: [
        { exercise_id: 2, exercise_name: "Romanian deadlift", set_number: 1, weight_kg: 80, reps: 8 },
        { exercise_id: 2, exercise_name: "Romanian deadlift", set_number: 2, weight_kg: 80, reps: 8 },
        { exercise_id: 1, exercise_name: "Bench press", set_number: 1, weight_kg: 60, reps: 11 },
        { exercise_id: 1, exercise_name: "Bench press", set_number: 2, weight_kg: 60, reps: 10 },
      ],
    },
    {
      id: 1, performed_on: "2026-11-11", notes: "first session",
      sets: [
        { exercise_id: 1, exercise_name: "Bench press", set_number: 1, weight_kg: 57.5, reps: 12 },
        { exercise_id: 1, exercise_name: "Bench press", set_number: 2, weight_kg: 57.5, reps: 12 },
      ],
    },
  ],

  // GET /exercises/{id}/next-session (progress service), one per exercise id
  nextSession: {
    1: {
      exercise_id: 1, exercise_name: "Bench press", based_on: "2026-11-17",
      action: "increase_weight", weight_kg: 62.5, target_reps: 8, sets: 3,
      reason: "Every set at 60.0 kg reached 12 reps. Add weight and start again at 8 reps.",
    },
    2: {
      exercise_id: 2, exercise_name: "Romanian deadlift", based_on: "2026-11-17",
      action: "add_reps", weight_kg: 80, target_reps: 9, sets: 2,
      reason: "Stay at 80 kg and aim for 9 reps on every set.",
    },
    3: {
      exercise_id: 3, exercise_name: "Squat", based_on: null,
      action: "no_history", weight_kg: null, target_reps: null, sets: null,
      reason: "No sessions logged for this exercise yet. Pick a weight you can lift for 5 reps and log it.",
    },
  },
};
