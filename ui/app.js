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
let coachExerciseId = state.exercises[0]?.id ?? null;
const serviceDown = { workouts: false, progress: false };

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

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
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
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const longDate = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const monthShort = new Intl.DateTimeFormat(undefined, { month: "short" });
const formatDate = (iso) => longDate.format(toDate(iso));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const exerciseById = (id) => state.exercises.find((ex) => ex.id === Number(id));
const nextId = (items) => Math.max(0, ...items.map((item) => item.id)) + 1;
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

// --- navigation (one page, four views, the URL hash says which) -----------------------------

const VIEWS = ["home", "log", "history", "exercises"];

function showView(name) {
  if (!VIEWS.includes(name)) name = "home";
  for (const view of VIEWS) document.getElementById(`view-${view}`).hidden = view !== name;
  for (const link of document.querySelectorAll(".tabbar a")) {
    const active = link.dataset.view === name;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  window.scrollTo(0, 0);
}

function go(name) {
  if (location.hash === `#${name}`) showView(name);
  else location.hash = name;
}

window.addEventListener("hashchange", () => showView(location.hash.slice(1)));

// --- service status ------------------------------------------------------------------------
// Each check gives up after 5 s, so a service that is down shows a message instead of a
// request that hangs. If one is down, the banner says what still works.

async function checkHealth(name, baseUrl) {
  const item = document.querySelector(`[data-service="${name}"]`);
  const label = item.querySelector(".state");
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    serviceDown[name] = !response.ok;
    label.textContent = response.ok ? "up" : "database down";
  } catch (error) {
    serviceDown[name] = true;
    label.textContent = error.name === "TimeoutError" ? "waking up" : "down";
  }
  item.className = serviceDown[name] ? "down" : "up";
  renderOutage();
}

function renderOutage() {
  const banner = document.getElementById("outage");
  const messages = [];
  if (serviceDown.workouts) messages.push("Workouts is unavailable: logging and history are paused.");
  if (serviceDown.progress) messages.push("Progress is unavailable: next-session suggestions are paused.");
  banner.hidden = messages.length === 0;
  banner.textContent = messages.length ? `${messages.join(" ")} Everything else still works.` : "";
}

// --- home: greeting, weekly stats, coach, recent -------------------------------------------

function renderGreeting() {
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  document.getElementById("greeting").textContent = `Good ${part} 👋`;
}

function lastSevenDays() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(isoDay(d));
  }
  return days;
}

function sparkline(values) {
  const max = Math.max(1, ...values);
  const points = values.map((v, i) => [(i / (values.length - 1)) * 100, 28 - (v / max) * 24]);
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return svg("svg", { class: "spark", viewBox: "0 0 100 30", preserveAspectRatio: "none", "aria-hidden": "true" },
    svg("path", { d: `${line} L100,30 L0,30 Z`, class: "spark-fill" }),
    svg("path", { d: line, class: "spark-line" }));
}

function renderStats() {
  const days = lastSevenDays();
  const setsPerDay = days.map((day) =>
    state.workouts.filter((w) => w.performed_on === day).reduce((n, w) => n + w.sets.length, 0));
  const volumePerDay = days.map((day) =>
    state.workouts.filter((w) => w.performed_on === day)
      .reduce((n, w) => n + w.sets.reduce((m, s) => m + s.weight_kg * s.reps, 0), 0));
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const card = (icon, label, value, unit, values, hint) =>
    el("div", { class: "stat" },
      el("div", { class: "stat-top" }, el("span", { class: "stat-icon", "aria-hidden": "true" }, icon), label),
      el("p", { class: "stat-value" }, value, el("small", {}, unit)),
      sparkline(values),
      el("p", { class: "stat-hint" }, hint));
  const last = state.workouts[0];
  document.getElementById("stat-cards").replaceChildren(
    card("▦", "Sets", String(sum(setsPerDay)), " sets", setsPerDay,
      `${plural(state.workouts.length, "workout")} logged`),
    card("◆", "Volume", compact.format(sum(volumePerDay)), " kg", volumePerDay,
      last ? `Last: ${formatDate(last.performed_on)}` : "No sessions yet"),
  );
}

const ACTION_LABEL = {
  increase_weight: "Add weight",
  add_reps: "Add reps",
  deload: "Deload",
  no_history: "First session",
};

function recommendationFor(ex) {
  return state.nextSession[ex.id] ?? {
    action: "no_history", weight_kg: null, target_reps: null, sets: null, based_on: null,
    reason: `No sessions logged for this exercise yet. Pick a weight you can lift for ${ex.rep_range_min} reps and log it.`,
  };
}

function renderCoach() {
  const chips = document.getElementById("coach-chips");
  const body = document.getElementById("coach-body");
  if (!exerciseById(coachExerciseId)) coachExerciseId = state.exercises[0]?.id ?? null;
  chips.replaceChildren(...state.exercises.map((ex) =>
    el("button", {
      type: "button", role: "tab", class: "chip",
      "aria-selected": String(ex.id === coachExerciseId),
      onclick: () => { coachExerciseId = ex.id; renderCoach(); },
    }, ex.name)));
  const ex = exerciseById(coachExerciseId);
  if (!ex) {
    body.replaceChildren(el("p", { class: "coach-reason" }, "Add an exercise to get a suggestion."));
    return;
  }
  const rec = recommendationFor(ex);
  document.getElementById("coach").dataset.action = rec.action;
  body.replaceChildren(
    el("span", { class: "coach-badge" }, ACTION_LABEL[rec.action] ?? rec.action),
    el("h3", { class: "coach-name" }, ex.name),
    rec.weight_kg === null ? null : el("p", { class: "coach-target" },
      `${rec.weight_kg}`, el("small", {}, " kg"), " × ", `${rec.target_reps}`, el("small", {}, " reps"),
      rec.sets ? el("span", { class: "coach-sets" }, plural(rec.sets, "set")) : null),
    el("p", { class: "coach-reason" }, rec.reason),
    el("div", { class: "coach-foot" },
      rec.based_on ? el("span", {}, `Based on ${formatDate(rec.based_on)}`) : el("span", {}, `${ex.rep_range_min}–${ex.rep_range_max} rep range`),
      el("button", { type: "button", class: "coach-cta", onclick: () => logFromCoach(ex, rec) },
        rec.weight_kg === null ? "Log first session" : "Log this session", el("span", { "aria-hidden": "true" }, " →"))),
  );
}

// fill the log form with the suggested sets, so following the coach is one tap
function logFromCoach(ex, rec) {
  resetLogForm();
  document.getElementById("set-rows").replaceChildren();
  const count = rec.sets ?? 1;
  for (let i = 0; i < count; i++) {
    addSetRow({ exercise_id: ex.id, weight_kg: rec.weight_kg ?? undefined, reps: rec.target_reps ?? undefined });
  }
  go("log");
}

function workoutSummary(w) {
  const date = toDate(w.performed_on);
  const names = [...new Set(w.sets.map((s) => s.exercise_name))];
  return [
    el("div", { class: "date-badge" },
      el("span", { class: "day" }, String(date.getDate())),
      el("span", { class: "month" }, monthShort.format(date))),
    el("div", { class: "grow" },
      el("strong", {}, names.join(", ") || "No sets"),
      el("span", { class: "meta" }, plural(w.sets.length, "set"), w.notes ? ` · ${w.notes}` : "")),
  ];
}

function renderRecent() {
  const list = document.getElementById("recent-list");
  if (state.workouts.length === 0) {
    list.replaceChildren(el("li", { class: "empty" }, "No workouts yet. Tap Log to add your first."));
    return;
  }
  list.replaceChildren(...state.workouts.slice(0, 3).map((w) =>
    el("li", {}, el("a", { href: "#history", class: "recent-item" }, ...workoutSummary(w),
      el("span", { class: "chevron", "aria-hidden": "true" }, "›")))));
}

function renderHome() {
  renderStats();
  renderCoach();
  renderRecent();
}

// --- exercises -----------------------------------------------------------------------------

function renderExercises() {
  document.getElementById("exercise-list").replaceChildren(
    ...state.exercises.map((ex) =>
      el("li", { class: ex.id === editingExerciseId ? "editing" : "" },
        el("span", { class: `body-dot ${ex.body_part}`, "aria-hidden": "true" }),
        el("div", { class: "grow" },
          el("strong", {}, ex.name),
          el("span", { class: "meta" }, `${ex.body_part === "upper" ? "Upper" : "Lower"} body · ${ex.rep_range_min}–${ex.rep_range_max} reps`)),
        el("button", { type: "button", class: "ghost small", onclick: () => editExercise(ex.id) }, "Edit"),
        el("button", { type: "button", class: "ghost small danger", onclick: () => deleteExercise(ex.id) }, "Delete"),
      ),
    ),
  );
  for (const select of document.querySelectorAll('select[name="exercise_id"]')) fillExerciseSelect(select);
  renderCoach();
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
  document.getElementById("exercise-form-heading").textContent = `Edit ${ex.name}`;
  document.getElementById("save-exercise").textContent = "Save changes";
  document.getElementById("cancel-exercise-edit").hidden = false;
  renderExercises();
  form.scrollIntoView({ behavior: "smooth", block: "center" });
  form.name.focus({ preventScroll: true });
}

function resetExerciseForm() {
  editingExerciseId = null;
  document.getElementById("exercise-form").reset();
  document.getElementById("exercise-form-heading").textContent = "New exercise";
  document.getElementById("save-exercise").textContent = "Add exercise";
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
  document.getElementById("log-heading").textContent = `Edit ${formatDate(workout.performed_on)}`;
  document.getElementById("save-workout").textContent = "Save changes";
  document.getElementById("cancel-workout-edit").hidden = false;
  go("log");
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

document.getElementById("cancel-workout-edit").addEventListener("click", () => {
  resetLogForm();
  go("history");
});

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
  const wasEditing = Boolean(editingWorkoutId);
  if (wasEditing) {
    Object.assign(state.workouts.find((w) => w.id === editingWorkoutId), { ...body, sets });
  } else {
    state.workouts.push({ id: nextId(state.workouts), ...body, sets });
  }
  state.workouts.sort((a, b) => b.performed_on.localeCompare(a.performed_on) || b.id - a.id);
  resetLogForm();
  renderWorkouts();
  toast(wasEditing ? "Workout updated." : `Workout saved with ${plural(sets.length, "set")}.`);
  go(wasEditing ? "history" : "home");
});

// --- history -------------------------------------------------------------------------------

function renderWorkouts() {
  const list = document.getElementById("workout-list");
  renderHome();
  if (state.workouts.length === 0) {
    list.replaceChildren(el("li", { class: "empty card" }, "No workouts yet. Tap Log to add your first."));
    return;
  }
  list.replaceChildren(
    ...state.workouts.map((w) =>
      el("li", {},
        el("details", { class: "card" },
          el("summary", {}, ...workoutSummary(w), el("span", { class: "chevron", "aria-hidden": "true" }, "›")),
          el("div", { class: "workout-body" },
            el("table", { class: "set-table" },
              el("tbody", {}, ...w.sets.map((s) =>
                el("tr", {},
                  el("td", {}, s.exercise_name),
                  el("td", { class: "muted" }, `Set ${s.set_number}`),
                  el("td", { class: "right" }, el("strong", {}, `${s.weight_kg} kg`), ` × ${s.reps}`))))),
            el("div", { class: "actions" },
              el("button", { type: "button", class: "ghost small", onclick: () => editWorkout(w.id) }, "Edit"),
              el("button", { type: "button", class: "ghost small danger", onclick: () => deleteWorkout(w.id) }, "Delete")))))),
  );
}

// --- start ---------------------------------------------------------------------------------

renderGreeting();
renderExercises();
resetLogForm();
renderWorkouts();
showView(location.hash.slice(1));
checkHealth("workouts", workoutsUrl);
checkHealth("progress", progressUrl);
