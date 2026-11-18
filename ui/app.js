// LiftLog UI, running on sample data (window.SAMPLE). Every add, edit and delete works on
// the page so the whole flow can be tried; each section is then wired to the services in
// its own PR (#13 log, #14 history, #15 exercises, #16 next session).
// Text from the data is always set with textContent, never innerHTML, so a workout note
// can't inject HTML into the page.

const TIMEOUT_MS = 5000;
const { workoutsUrl, progressUrl } = window.LIFTLOG_CONFIG;
const state = structuredClone(window.SAMPLE);
let editingWorkoutId = null;
let editingExerciseId = null;

// --- helpers -------------------------------------------------------------------------------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

let toastTimer;
function toast(text, kind = "ok") {
  const node = document.getElementById("toast");
  node.textContent = text;
  node.className = `toast ${kind}`;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 3500);
}

const toDate = (iso) => new Date(`${iso}T00:00:00`);
const longDate = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const monthShort = new Intl.DateTimeFormat(undefined, { month: "short" });
const formatDate = (iso) => longDate.format(toDate(iso));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const exerciseById = (id) => state.exercises.find((ex) => ex.id === Number(id));
const nextId = (items) => Math.max(0, ...items.map((item) => item.id)) + 1;

// --- service status ------------------------------------------------------------------------
// Each check gives up after 5 s, so a service that is down shows a message instead of a
// request that hangs.

async function checkHealth(name, baseUrl) {
  const item = document.querySelector(`[data-service="${name}"]`);
  const label = item.querySelector(".state");
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    label.textContent = response.ok ? "up" : "database unavailable";
    item.className = response.ok ? "up" : "down";
  } catch (error) {
    label.textContent = error.name === "TimeoutError" ? "waking up…" : "unreachable";
    item.className = "down";
  }
}

// --- stats ---------------------------------------------------------------------------------

function renderStats() {
  const weekAgo = new Date();
  weekAgo.setHours(0, 0, 0, 0);
  weekAgo.setDate(weekAgo.getDate() - 6);
  const setsThisWeek = state.workouts
    .filter((w) => toDate(w.performed_on) >= weekAgo)
    .reduce((sum, w) => sum + w.sets.length, 0);
  const last = state.workouts[0];
  const stat = (value, label) => el("div", {}, el("dt", {}, label), el("dd", {}, String(value)));
  document.getElementById("stats").replaceChildren(
    stat(state.workouts.length, "Workouts"),
    stat(setsThisWeek, "Sets this week"),
    stat(last ? formatDate(last.performed_on) : "–", "Last session"),
  );
}

// --- exercises -----------------------------------------------------------------------------

function renderExercises() {
  document.getElementById("exercise-list").replaceChildren(
    ...state.exercises.map((ex) =>
      el("li", { class: ex.id === editingExerciseId ? "editing" : "" },
        el("div", { class: "grow" },
          el("strong", {}, ex.name),
          el("span", { class: "meta" }, `${ex.rep_range_min}–${ex.rep_range_max} reps`)),
        el("span", { class: `tag ${ex.body_part}` }, ex.body_part),
        el("button", { type: "button", class: "ghost small", onclick: () => editExercise(ex.id) }, "Edit"),
        el("button", { type: "button", class: "ghost small danger", onclick: () => deleteExercise(ex.id) }, "Delete"),
      ),
    ),
  );
  for (const select of document.querySelectorAll('select[name="exercise_id"], #next-exercise')) {
    fillExerciseSelect(select);
  }
}

function fillExerciseSelect(select) {
  const current = select.value;
  select.replaceChildren(...state.exercises.map((ex) => el("option", { value: ex.id }, ex.name)));
  if (current && exerciseById(current)) select.value = current;
}

function editExercise(id) {
  const ex = exerciseById(id);
  const form = document.getElementById("exercise-form");
  editingExerciseId = ex.id;
  form.name.value = ex.name;
  form.body_part.value = ex.body_part;
  form.rep_range_min.value = ex.rep_range_min;
  form.rep_range_max.value = ex.rep_range_max;
  document.getElementById("save-exercise").textContent = "Save";
  document.getElementById("cancel-exercise-edit").hidden = false;
  renderExercises();
  form.name.focus();
}

function resetExerciseForm() {
  editingExerciseId = null;
  document.getElementById("exercise-form").reset();
  document.getElementById("save-exercise").textContent = "Add";
  document.getElementById("cancel-exercise-edit").hidden = true;
  renderExercises();
}

function deleteExercise(id) {
  const ex = exerciseById(id);
  // same rule as the API: 409 if any workout uses the exercise
  if (state.workouts.some((w) => w.sets.some((s) => s.exercise_id === ex.id))) {
    toast(`${ex.name} is used in a workout. Delete those workouts first.`, "error");
    return;
  }
  if (!confirm(`Delete ${ex.name}?`)) return;
  state.exercises = state.exercises.filter((e) => e.id !== ex.id);
  delete state.nextSession[ex.id];
  if (editingExerciseId === ex.id) resetExerciseForm();
  else renderExercises();
  renderNextSession(document.getElementById("next-exercise").value);
  toast(`Deleted ${ex.name}.`);
}

document.getElementById("exercise-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  const exercise = {
    name: form.name.value.trim(),
    body_part: form.body_part.value,
    rep_range_min: Number(form.rep_range_min.value),
    rep_range_max: Number(form.rep_range_max.value),
  };
  if (exercise.rep_range_min > exercise.rep_range_max) {
    toast("The lowest rep count can't be higher than the highest.", "error");
    return;
  }
  const clash = state.exercises.find(
    (ex) => ex.name.toLowerCase() === exercise.name.toLowerCase() && ex.id !== editingExerciseId,
  );
  if (clash) {
    toast(`There is already an exercise called ${clash.name}.`, "error");
    return;
  }
  if (editingExerciseId) {
    Object.assign(exerciseById(editingExerciseId), exercise);
    for (const w of state.workouts) {
      for (const s of w.sets) if (s.exercise_id === editingExerciseId) s.exercise_name = exercise.name;
    }
    toast(`Saved ${exercise.name}.`);
  } else {
    state.exercises.push({ id: nextId(state.exercises), ...exercise });
    toast(`Added ${exercise.name}.`);
  }
  state.exercises.sort((a, b) => a.name.localeCompare(b.name));
  resetExerciseForm();
  renderWorkouts();
});

document.getElementById("cancel-exercise-edit").addEventListener("click", resetExerciseForm);

// --- log or edit a workout -----------------------------------------------------------------

function addSetRow(values = {}) {
  const row = document.getElementById("set-row").content.firstElementChild.cloneNode(true);
  const select = row.querySelector("select");
  fillExerciseSelect(select);
  if (values.exercise_id) select.value = values.exercise_id;
  if (values.weight_kg !== undefined) row.querySelector('[name="weight_kg"]').value = values.weight_kg;
  if (values.reps !== undefined) row.querySelector('[name="reps"]').value = values.reps;
  row.querySelector(".remove-set").addEventListener("click", () => {
    if (document.querySelectorAll(".set-row").length > 1) row.remove();
  });
  document.getElementById("set-rows").append(row);
}

function resetLogForm() {
  editingWorkoutId = null;
  const form = document.getElementById("log-form");
  form.reset();
  form.performed_on.valueAsDate = new Date();
  document.getElementById("set-rows").replaceChildren();
  addSetRow();
  document.getElementById("log-heading").textContent = "Log a workout";
  document.getElementById("save-workout").textContent = "Save workout";
  document.getElementById("cancel-workout-edit").hidden = true;
}

function editWorkout(id) {
  const workout = state.workouts.find((w) => w.id === id);
  const form = document.getElementById("log-form");
  editingWorkoutId = id;
  form.performed_on.value = workout.performed_on;
  form.notes.value = workout.notes;
  document.getElementById("set-rows").replaceChildren();
  workout.sets.forEach((s) => addSetRow(s));
  document.getElementById("log-heading").textContent = `Edit workout · ${formatDate(workout.performed_on)}`;
  document.getElementById("save-workout").textContent = "Save changes";
  document.getElementById("cancel-workout-edit").hidden = false;
  document.getElementById("log-heading").scrollIntoView({ behavior: "smooth", block: "start" });
}

function deleteWorkout(id) {
  const workout = state.workouts.find((w) => w.id === id);
  if (!confirm(`Delete the workout from ${formatDate(workout.performed_on)}?`)) return;
  state.workouts = state.workouts.filter((w) => w.id !== id);
  if (editingWorkoutId === id) resetLogForm();
  renderWorkouts();
  toast("Workout deleted.");
}

document.getElementById("add-set").addEventListener("click", () => {
  // start the new row from the previous one: same exercise and weight is the usual next set
  const rows = document.querySelectorAll(".set-row");
  const prev = rows[rows.length - 1];
  addSetRow(prev ? {
    exercise_id: prev.querySelector("select").value,
    weight_kg: prev.querySelector('[name="weight_kg"]').value,
  } : {});
});

document.getElementById("cancel-workout-edit").addEventListener("click", resetLogForm);

document.getElementById("log-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  // this body is exactly what #13 will POST to /workouts (PUT /workouts/{id} when editing)
  const body = {
    performed_on: form.performed_on.value,
    notes: form.notes.value.trim(),
    sets: [...form.querySelectorAll(".set-row")].map((row) => ({
      exercise_id: Number(row.querySelector("select").value),
      weight_kg: Number(row.querySelector('[name="weight_kg"]').value),
      reps: Number(row.querySelector('[name="reps"]').value),
    })),
  };
  // what the API sends back: sets numbered per exercise, in the order sent
  const counter = {};
  const sets = body.sets.map((s) => ({
    ...s,
    exercise_name: exerciseById(s.exercise_id).name,
    set_number: (counter[s.exercise_id] = (counter[s.exercise_id] ?? 0) + 1),
  }));
  if (editingWorkoutId) {
    Object.assign(state.workouts.find((w) => w.id === editingWorkoutId), { ...body, sets });
    toast("Workout updated.");
  } else {
    state.workouts.push({ id: nextId(state.workouts), ...body, sets });
    toast(`Workout saved with ${plural(sets.length, "set")}.`);
  }
  state.workouts.sort((a, b) => b.performed_on.localeCompare(a.performed_on) || b.id - a.id);
  resetLogForm();
  renderWorkouts();
});

// --- history -------------------------------------------------------------------------------

function renderWorkouts() {
  const list = document.getElementById("workout-list");
  renderStats();
  if (state.workouts.length === 0) {
    list.replaceChildren(el("li", { class: "empty" }, "No workouts yet. Log your first one."));
    return;
  }
  list.replaceChildren(
    ...state.workouts.map((w) => {
      const date = toDate(w.performed_on);
      const names = [...new Set(w.sets.map((s) => s.exercise_name))];
      return el("li", {},
        el("details", {},
          el("summary", {},
            el("div", { class: "date-badge" },
              el("span", { class: "day" }, String(date.getDate())),
              el("span", { class: "month" }, monthShort.format(date))),
            el("div", { class: "grow" },
              el("strong", {}, names.join(", ") || "No sets"),
              el("span", { class: "meta" }, plural(w.sets.length, "set"), w.notes ? ` · ${w.notes}` : "")),
            el("span", { class: "chevron", "aria-hidden": "true" }, "›")),
          el("div", { class: "workout-body" },
            el("table", { class: "set-table" },
              el("tbody", {}, ...w.sets.map((s) =>
                el("tr", {},
                  el("td", {}, s.exercise_name),
                  el("td", { class: "muted" }, `Set ${s.set_number}`),
                  el("td", { class: "right" }, `${s.weight_kg} kg × ${s.reps}`))))),
            el("div", { class: "actions" },
              el("button", { type: "button", class: "ghost small", onclick: () => editWorkout(w.id) }, "Edit"),
              el("button", { type: "button", class: "ghost small danger", onclick: () => deleteWorkout(w.id) }, "Delete")))));
    }),
  );
}

// --- next session (coach) ------------------------------------------------------------------

const ACTION_LABEL = {
  increase_weight: "Add weight",
  add_reps: "Add reps",
  deload: "Deload",
  no_history: "No history yet",
};

function renderNextSession(exerciseId) {
  const card = document.getElementById("next-card");
  const ex = exerciseById(exerciseId);
  if (!ex) {
    card.className = "coach";
    card.replaceChildren(el("p", { class: "muted" }, "Add an exercise to get a suggestion."));
    return;
  }
  const rec = state.nextSession[ex.id] ?? {
    action: "no_history", weight_kg: null, based_on: null,
    reason: `No sessions logged for this exercise yet. Pick a weight you can lift for ${ex.rep_range_min} reps and log it.`,
  };
  card.className = `coach action-${rec.action}`;
  card.replaceChildren(
    el("span", { class: "badge" }, ACTION_LABEL[rec.action] ?? rec.action),
    rec.weight_kg === null ? null : el("p", { class: "target" },
      `${rec.weight_kg}`, el("small", {}, " kg"), " × ", `${rec.target_reps}`, el("small", {}, " reps")),
    rec.sets ? el("p", { class: "sets-count" }, `for ${plural(rec.sets, "set")}`) : null,
    el("p", { class: "reason" }, rec.reason),
    rec.based_on ? el("p", { class: "muted small" }, `Based on your session on ${formatDate(rec.based_on)}`) : null,
  );
}

document.getElementById("next-exercise").addEventListener("change", (event) => renderNextSession(event.target.value));

// --- start ---------------------------------------------------------------------------------

renderExercises();
resetLogForm();
renderWorkouts();
renderNextSession(document.getElementById("next-exercise").value);
checkHealth("workouts", workoutsUrl);
checkHealth("progress", progressUrl);
