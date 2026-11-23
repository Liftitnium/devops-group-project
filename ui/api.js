// Talks to the two services. Every failure becomes an ApiError whose message can be shown
// to the user as-is: the service's own `detail` when it answered, or a plain sentence when
// it didn't.
//
// On Azure both services and their databases sleep when nobody uses them, and the first
// request after a quiet period can take 20-50 s while they wake up. So a read (GET) that
// times out is tried again, for up to WAKE_LIMIT_MS, and the page is told it is "waking"
// so it can say "Starting up" instead of showing an error. A save is never sent twice
// (that could store a workout twice): it gets one long attempt instead.

// Wrapped in a function so only window.api is global (app.js has its own names).
(() => {
  const READ_TIMEOUT_MS = 10000; // one attempt at a read
  const WRITE_TIMEOUT_MS = 60000; // the only attempt at a save
  const WAKE_LIMIT_MS = 90000; // how long reads keep trying while a service wakes up
  const RETRY_PAUSE_MS = 1000;

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status; // 0 = no answer (down, unreachable or timed out)
    }
  }

  // how many reads are waiting for a service to wake up; app.js shows a banner while > 0
  let waiting = 0;
  function setWaiting(change) {
    waiting += change;
    window.dispatchEvent(new CustomEvent("liftlog:waking", { detail: waiting > 0 }));
  }
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function send(baseUrl, service, method, path, body) {
    const read = method === "GET";
    const options = {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    const started = Date.now();
    let waking = false;
    try {
      for (;;) {
        try {
          return await fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(read ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS) });
        } catch (error) {
          const timedOut = error.name === "TimeoutError";
          // only a slow answer means "waking up"; a refused connection means it's down,
          // and that should be said straight away
          if (read && timedOut && Date.now() - started < WAKE_LIMIT_MS) {
            if (!waking) { waking = true; setWaiting(1); }
            await pause(RETRY_PAUSE_MS);
            continue;
          }
          if (!timedOut) throw new ApiError(`Can't reach the ${service} service right now. Try again shortly.`, 0);
          throw new ApiError(read
            ? `The ${service} service is taking too long to start. Try again in a moment.`
            : `The ${service} service didn't answer in time. Check whether it was saved before trying again.`, 0);
        }
      }
    } finally {
      if (waking) setWaiting(-1);
    }
  }

  async function request(baseUrl, service, method, path, body) {
    const response = await send(baseUrl, service, method, path, body);
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
