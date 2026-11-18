// LiftLog UI. Reads and writes through window.api (api.js): exercises (#15), logging and
// editing workouts (#13), history (#14) and the next-session coach (#16).
// Text from the services is always set with textContent, never innerHTML, so a workout
// note can't inject HTML into the page.

const HEALTH_TIMEOUT_MS = 5000;
const { workoutsUrl, progressUrl } = window.LIFTLOG_CONFIG;
const api = window.api;

const state = {
  exercises: [], // GET /exercises
  workouts: [], // GET /workouts: summaries with set_count, newest first
  details: new Map(), // workout id -> GET /workouts/{id}, fetched when needed
  coach: new Map(), // exercise id -> next-session answer (or { error })
  loading: true,
  loadError: null,
};
let editingWorkoutId = null;
let editingExerciseId = null;
let coachExerciseId = null;
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
  toastTimer = setTimeout(() => { node.hidden = true; }, kind === "error" ? 6000 : 3500);
}

// run an API call with a button disabled meanwhile; errors become a toast
async function withButton(button, busyText, action) {
  const text = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  try {
    return await action();
  } catch (error) {
    toast(error.message, "error");
    return undefined;
  } finally {
    button.disabled = false;
    button.textContent = text;
  }
}

const toDate = (iso) => new Date(`${iso}T00:00:00`);
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const longDate = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const monthShort = new Intl.DateTimeFormat(undefined, { month: "short" });
const formatDate = (iso) => longDate.format(toDate(iso));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const exerciseById = (id) => state.exercises.find((ex) => ex.id === Number(id));
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

// --- loading data --------------------------------------------------------------------------

function lastSevenDays() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(isoDay(d));
  }
  return days;
}

async function loadDetails(ids) {
  const missing = ids.filter((id) => !state.details.has(id));
  const workouts = await Promise.all(missing.map((id) => api.getWorkout(id)));
  for (const w of workouts) state.details.set(w.id, w);
}

// everything the home page needs: exercises, workout list, and the sets of this week's
// workouts plus the few shown under Recent (the list endpoint only gives set counts)
async function loadAll() {
  try {
    const [exercises, workouts] = await Promise.all([api.listExercises(), api.listWorkouts()]);
    state.exercises = exercises;
    state.workouts = workouts;
    state.details.clear();
    state.coach.clear();
    const week = new Set(lastSevenDays());
    await loadDetails(workouts.filter((w, i) => i < 5 || week.has(w.performed_on)).map((w) => w.id));
    state.loadError = null;
  } catch (error) {
    state.loadError = error.message;
  }
  state.loading = false;
  renderAll();
}

function renderAll() {
  renderExercises();
  renderWorkouts();
  renderHome();
  renderLogHint();
}

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
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
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
  const onDay = (day) => state.workouts.filter((w) => w.performed_on === day);
  const setsPerDay = days.map((day) => onDay(day).reduce((n, w) => n + w.set_count, 0));
  const volumePerDay = days.map((day) => onDay(day).reduce((n, w) => {
    const detail = state.details.get(w.id);
    return n + (detail ? detail.sets.reduce((m, s) => m + s.weight_kg * s.reps, 0) : 0);
  }, 0));
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

async function loadCoach(exerciseId) {
  if (state.coach.has(exerciseId)) return;
  state.coach.set(exerciseId, { loading: true });
  try {
    state.coach.set(exerciseId, await api.nextSession(exerciseId));
  } catch (error) {
    state.coach.set(exerciseId, { error: error.message });
  }
  if (coachExerciseId === exerciseId) renderCoach();
}

function renderCoach() {
  const card = document.getElementById("coach");
  const chips = document.getElementById("coach-chips");
  const body = document.getElementById("coach-body");
  if (!exerciseById(coachExerciseId)) coachExerciseId = state.exercises[0]?.id ?? null;
  chips.replaceChildren(...state.exercises.map((ex) =>
    el("button", {
      type: "button", role: "tab", class: "chip",
      "aria-selected": String(ex.id === coachExerciseId),
      onclick: () => { coachExerciseId = ex.id; renderCoach(); },
    }, ex.name)));
  delete card.dataset.action;
  const ex = exerciseById(coachExerciseId);
  if (!ex) {
    const message = state.loading ? "Loading…"
      : state.loadError ? `${state.loadError} Suggestions come back as soon as it does.`
      : "Add an exercise and log a session to get your first suggestion.";
    const showAdd = !state.loading && !state.loadError;
    body.replaceChildren(
      el("h3", { class: "coach-name" }, "Your coach"),
      el("p", { class: "coach-reason" }, message),
      showAdd ? el("div", { class: "coach-foot" }, el("span", {}),
        el("a", { href: "#exercises", class: "coach-cta" }, "Add exercise", el("span", { "aria-hidden": "true" }, " →"))) : null);
    return;
  }
  const rec = state.coach.get(ex.id);
  if (!rec) loadCoach(ex.id);
  if (!rec || rec.loading) {
    body.replaceChildren(el("h3", { class: "coach-name" }, ex.name), el("p", { class: "coach-reason" }, "Asking the coach…"));
    return;
  }
  if (rec.error) {
    body.replaceChildren(
      el("h3", { class: "coach-name" }, ex.name),
      el("p", { class: "coach-reason" }, rec.error),
      el("div", { class: "coach-foot" }, el("span", {}),
        el("button", { type: "button", class: "coach-cta", onclick: () => { state.coach.delete(ex.id); renderCoach(); } }, "Try again")));
    return;
  }
  card.dataset.action = rec.action;
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
  const detail = state.details.get(w.id);
  const names = detail ? [...new Set(detail.sets.map((s) => s.exercise_name))].join(", ") : "";
  return [
    el("div", { class: "date-badge" },
      el("span", { class: "day" }, String(date.getDate())),
      el("span", { class: "month" }, monthShort.format(date))),
    el("div", { class: "grow" },
      el("strong", {}, names || w.notes || "Workout"),
      el("span", { class: "meta" }, plural(w.set_count, "set"), names && w.notes ? ` · ${w.notes}` : "")),
  ];
}

function statusItem(text, retry) {
  return el("li", { class: "empty card" }, text, retry
    ? el("div", {}, el("button", { type: "button", class: "ghost small retry", onclick: retry }, "Try again"))
    : null);
}

function retryLoad() {
  state.loading = true;
  renderAll();
  loadAll();
}

function renderRecent() {
  const list = document.getElementById("recent-list");
  if (state.loading) return list.replaceChildren(statusItem("Loading…"));
  if (state.loadError) return list.replaceChildren(statusItem(state.loadError, retryLoad));
  if (state.workouts.length === 0) {
    return list.replaceChildren(statusItem("No workouts yet. Tap Log to add your first."));
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
  const list = document.getElementById("exercise-list");
  if (state.loading) list.replaceChildren(statusItem("Loading…"));
  else if (state.loadError) list.replaceChildren(statusItem(state.loadError, retryLoad));
  else if (state.exercises.length === 0) list.replaceChildren(statusItem("No exercises yet. Add your first one below."));
  else {
    list.replaceChildren(...state.exercises.map((ex) =>
      el("li", { class: ex.id === editingExerciseId ? "editing" : "" },
        el("span", { class: `body-dot ${ex.body_part}`, "aria-hidden": "true" }),
        el("div", { class: "grow" },
          el("strong", {}, ex.name),
          el("span", { class: "meta" }, `${ex.body_part === "upper" ? "Upper" : "Lower"} body · ${ex.rep_range_min}–${ex.rep_range_max} reps`)),
        el("button", { type: "button", class: "ghost small", onclick: () => editExercise(ex.id) }, "Edit"),
        el("button", { type: "button", class: "ghost small danger", onclick: (e) => deleteExercise(ex.id, e.currentTarget) }, "Delete"),
      )));
  }
  for (const select of document.querySelectorAll('select[name="exercise_id"]')) fillExerciseSelect(select);
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

async function deleteExercise(id, button) {
  const ex = exerciseById(id);
  if (!confirm(`Delete ${ex.name}?`)) return;
  // the service refuses (409, with a readable message) if any workout uses it
  const done = await withButton(button, "…", async () => {
    await api.deleteExercise(ex.id);
    return true;
  });
  if (!done) return;
  if (editingExerciseId === ex.id) resetExerciseForm();
  toast(`Deleted ${ex.name}.`);
  await loadAll();
}

document.getElementById("exercise-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const exercise = {
    name: form.name.value.trim(),
    body_part: form.body_part.value,
    rep_range_min: Number(form.rep_range_min.value),
    rep_range_max: Number(form.rep_range_max.value),
  };
  // checked here too for a friendlier sentence; the service checks it again
  if (exercise.rep_range_min > exercise.rep_range_max) {
    toast("The lowest rep count can't be higher than the highest.", "error");
    return;
  }
  const wasEditing = editingExerciseId;
  const saved = await withButton(document.getElementById("save-exercise"), "Saving…", () =>
    wasEditing ? api.updateExercise(wasEditing, exercise) : api.createExercise(exercise));
  if (!saved) return;
  toast(wasEditing ? `Saved ${saved.name}.` : `Added ${saved.name}.`);
  resetExerciseForm();
  await loadAll();
});

document.getElementById("cancel-exercise-edit").addEventListener("click", resetExerciseForm);

// --- log or edit a workout -----------------------------------------------------------------

function renderLogHint() {
  const noExercises = !state.loading && !state.loadError && state.exercises.length === 0;
  document.getElementById("log-hint").hidden = !noExercises;
  document.getElementById("save-workout").disabled = noExercises || Boolean(state.loadError);
}

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

async function editWorkout(id, button) {
  const ok = await withButton(button, "…", async () => {
    await loadDetails([id]);
    return true;
  });
  if (!ok) return;
  const workout = state.details.get(id);
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

async function deleteWorkout(id, button) {
  const workout = state.workouts.find((w) => w.id === id);
  if (!confirm(`Delete the workout from ${formatDate(workout.performed_on)}?`)) return;
  const done = await withButton(button, "…", async () => {
    await api.deleteWorkout(id);
    return true;
  });
  if (!done) return;
  if (editingWorkoutId === id) resetLogForm();
  toast("Workout deleted.");
  await loadAll();
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

document.getElementById("log-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const workout = {
    performed_on: form.performed_on.value,
    notes: form.notes.value.trim(),
    sets: [...form.querySelectorAll(".set-row")].map((row) => ({
      exercise_id: Number(row.querySelector("select").value),
      weight_kg: Number(row.querySelector('[name="weight_kg"]').value),
      reps: Number(row.querySelector('[name="reps"]').value),
    })),
  };
  const wasEditing = editingWorkoutId;
  const saved = await withButton(document.getElementById("save-workout"), "Saving…", () =>
    wasEditing ? api.updateWorkout(wasEditing, workout) : api.createWorkout(workout));
  if (!saved) return;
  resetLogForm();
  toast(wasEditing ? "Workout updated." : `Workout saved with ${plural(saved.sets.length, "set")}.`);
  go(wasEditing ? "history" : "home");
  await loadAll();
});

// --- history -------------------------------------------------------------------------------

function workoutBody(w) {
  const detail = state.details.get(w.id);
  if (!detail) return el("p", { class: "muted" }, "Loading sets…");
  return el("div", {},
    el("table", { class: "set-table" },
      el("tbody", {}, ...detail.sets.map((s) =>
        el("tr", {},
          el("td", {}, s.exercise_name),
          el("td", { class: "muted" }, `Set ${s.set_number}`),
          el("td", { class: "right" }, el("strong", {}, `${s.weight_kg} kg`), ` × ${s.reps}`))))),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "ghost small", onclick: (e) => editWorkout(w.id, e.currentTarget) }, "Edit"),
      el("button", { type: "button", class: "ghost small danger", onclick: (e) => deleteWorkout(w.id, e.currentTarget) }, "Delete")));
}

// sets of older workouts are fetched the first time the row is opened
async function onToggle(event, w) {
  const details = event.currentTarget;
  if (!details.open || state.details.has(w.id)) return;
  try {
    await loadDetails([w.id]);
  } catch (error) {
    details.querySelector(".workout-body").replaceChildren(el("p", { class: "muted" }, error.message));
    return;
  }
  details.querySelector("summary").replaceChildren(...workoutSummary(w), el("span", { class: "chevron", "aria-hidden": "true" }, "›"));
  details.querySelector(".workout-body").replaceChildren(workoutBody(w));
}

function renderWorkouts() {
  const list = document.getElementById("workout-list");
  if (state.loading) return list.replaceChildren(statusItem("Loading…"));
  if (state.loadError) return list.replaceChildren(statusItem(state.loadError, retryLoad));
  if (state.workouts.length === 0) return list.replaceChildren(statusItem("No workouts yet. Tap Log to add your first."));
  list.replaceChildren(...state.workouts.map((w) =>
    el("li", {},
      el("details", { class: "card", ontoggle: (e) => onToggle(e, w) },
        el("summary", {}, ...workoutSummary(w), el("span", { class: "chevron", "aria-hidden": "true" }, "›")),
        el("div", { class: "workout-body" }, workoutBody(w))))));
}

// --- start ---------------------------------------------------------------------------------

renderGreeting();
resetLogForm();
renderAll();
showView(location.hash.slice(1));
loadAll();
checkHealth("workouts", workoutsUrl);
checkHealth("progress", progressUrl);
