// Talks to the two services. Every call gives up after API_TIMEOUT_MS, and every failure
// becomes an ApiError whose message can be shown to the user as-is: the service's own
// `detail` when it answered, or a plain sentence when it didn't.

// Wrapped in a function so only window.api is global (app.js has its own names).
(() => {
  const API_TIMEOUT_MS = 10000; // Azure SQL serverless can take a few seconds to wake up

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status; // 0 = no answer (down, unreachable or timed out)
    }
  }

  async function request(baseUrl, service, method, path, body) {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ApiError(
        error.name === "TimeoutError"
          ? `The ${service} service didn't answer in time (it may be waking up). Try again in a moment.`
          : `Can't reach the ${service} service right now. Try again shortly.`,
        0,
      );
    }
    if (response.status === 204) return null;
    let data = null;
    try {
      data = await response.json();
    } catch {
      // not JSON: fall through to the generic message below
    }
    if (!response.ok) {
      const detail = typeof data?.detail === "string" ? data.detail : null;
      throw new ApiError(detail ?? `The ${service} service answered with an error (${response.status}).`, response.status);
    }
    return data;
  }

  const { workoutsUrl, progressUrl } = window.LIFTLOG_CONFIG;
  const workoutsApi = (method, path, body) => request(workoutsUrl, "workouts", method, path, body);
  const progressApi = (method, path, body) => request(progressUrl, "progress", method, path, body);

  // one function per endpoint in docs/workouts-api.md and docs/api.md
  window.api = {
    listExercises: () => workoutsApi("GET", "/exercises"),
    createExercise: (exercise) => workoutsApi("POST", "/exercises", exercise),
    updateExercise: (id, exercise) => workoutsApi("PUT", `/exercises/${id}`, exercise),
    deleteExercise: (id) => workoutsApi("DELETE", `/exercises/${id}`),

    listWorkouts: () => workoutsApi("GET", "/workouts"),
    getWorkout: (id) => workoutsApi("GET", `/workouts/${id}`),
    createWorkout: (workout) => workoutsApi("POST", "/workouts", workout),
    updateWorkout: (id, workout) => workoutsApi("PUT", `/workouts/${id}`, workout),
    deleteWorkout: (id) => workoutsApi("DELETE", `/workouts/${id}`),

    nextSession: (exerciseId) => progressApi("GET", `/exercises/${exerciseId}/next-session`),
    exerciseRecords: (exerciseId) => progressApi("GET", `/exercises/${exerciseId}/records`),

    listGoals: () => progressApi("GET", "/goals"),
    createGoal: (goal) => progressApi("POST", "/goals", goal),
    updateGoal: (id, goal) => progressApi("PUT", `/goals/${id}`, goal),
    deleteGoal: (id) => progressApi("DELETE", `/goals/${id}`),
    goalProgress: (id) => progressApi("GET", `/goals/${id}/progress`),
  };
})();
