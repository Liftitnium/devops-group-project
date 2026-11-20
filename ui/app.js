// LiftLog UI. Reads and writes through window.api (api.js): exercises (#15), logging and
// editing workouts (#13), history (#14) and the next-session coach (#16).
// Text from the services is always set with textContent, never innerHTML, so a workout
// note can't inject HTML into the page.

const HEALTH_TIMEOUT_MS = 5000;
const DELETE_CONFIRM_MS = 4000;
const { workoutsUrl, progressUrl } = window.LIFTLOG_CONFIG;
const api = window.api;

const state = {
  exercises: [], // GET /exercises
  workouts: [], // GET /workouts: summaries with set_count, newest first
  details: new Map(), // workout id -> GET /workouts/{id}, fetched when needed
  coach: new Map(), // exercise id -> next-session answer, { loading } or { error }
  loading: true, // true until the exercise and workout lists have arrived
  detailsLoading: false, // true while this fortnight's sets are being fetched
  loadError: null,
};
let editingWorkoutId = null;
let editingExerciseId = null;
let coachExerciseId = null;
const serviceDown = { workouts: false, progress: false };

// --- helpers -------------------------------------------------------------------------------

// null/false children are skipped (replaceChildren would print "null")
const clean = (children) => children.filter((c) => c !== null && c !== undefined && c !== false);
const put = (node, ...children) => node.replaceChildren(...clean(children));

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...clean(children));
  return node;
}

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

// one stroke icon set, same 24px grid and 2px stroke as the tab bar
const ICONS = {
  x: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  check: "M5 12.5l4.5 4.5L19 7.5",
  alert: "M12 8v5M12 16.5v.5M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  chevron: "M9 6l6 6-6 6",
  arrow: "M5 12h14M13 6l6 6-6 6",
  stack: "M4 7h16M4 12h16M4 17h16",
  weight: "M6 8h12l2 12H4zM9 8a3 3 0 0 1 6 0",
  up: "M12 19V5M6 11l6-6 6 6",
  hold: "M5 12h14",
  down: "M12 5v14M6 13l6 6 6-6",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4",
};
const icon = (name) => svg("svg", { class: "ico", viewBox: "0 0 24 24", "aria-hidden": "true" },
  svg("path", { d: ICONS[name] }));

let toastTimer;
function toast(text, kind = "ok") {
  const node = document.getElementById("toast");
  put(node, icon(kind === "error" ? "alert" : "check"), el("span", {}, text));
  node.className = `toast ${kind}`;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, kind === "error" ? 7000 : 3500);
}
function hideToast() { document.getElementById("toast").hidden = true; }
// an error is about what the user typed; once they change it, the message is stale
for (const id of ["log-form", "exercise-form"]) {
  document.getElementById(id).addEventListener("input", () => {
    if (document.getElementById("toast").classList.contains("error")) hideToast();
  });
}

// run an API call with a button disabled meanwhile; errors become a toast
async function withButton(button, busyText, action) {
  const text = button.textContent;
  button.disabled = true;
  button.classList.add("busy");
  button.textContent = busyText;
  try {
    return await action();
  } catch (error) {
    toast(error.message, "error");
    return undefined;
  } finally {
    button.disabled = false;
    button.classList.remove("busy");
    button.textContent = text;
  }
}

// destructive buttons ask twice: the first press arms them for a few seconds
function confirmButton(label, armedLabel, action) {
  let timer;
  const button = el("button", { type: "button", class: "ghost small quiet-danger" }, label);
  button.addEventListener("click", () => {
    if (!button.classList.contains("armed")) {
      button.classList.add("armed");
      button.textContent = armedLabel;
      timer = setTimeout(() => { button.classList.remove("armed"); button.textContent = label; }, DELETE_CONFIRM_MS);
      return;
    }
    clearTimeout(timer);
    button.classList.remove("armed");
    button.textContent = label;
    action(button);
  });
  return button;
}

// dates read the same everywhere: "Tue 17 Nov"
const toDate = (iso) => new Date(`${iso}T00:00:00`);
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shortFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const longFmt = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "short" });
const letterFmt = new Intl.DateTimeFormat("en-GB", { weekday: "narrow" });
const formatDate = (iso) => shortFmt.format(toDate(iso));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const exerciseById = (id) => state.exercises.find((ex) => ex.id === Number(id));
const compact = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });
const kg = (n) => `${Number(n)}`;

// --- loading data --------------------------------------------------------------------------

function daysBack(count, offset = 0) {
  const days = [];
  for (let i = count - 1 + offset; i >= offset; i--) {
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

// First the two lists (fast): every page can render real content. Then the sets of the
// last 14 days and of the Recent rows, for volume and exercise names. The coach is asked
// about every exercise at once, so switching exercise is instant.
async function loadAll() {
  try {
    const [exercises, workouts] = await Promise.all([api.listExercises(), api.listWorkouts()]);
    state.exercises = exercises;
    state.workouts = workouts;
    state.details.clear();
    state.coach.clear();
    state.loadError = null;
  } catch (error) {
    state.loadError = error.message;
  }
  state.loading = false;
  state.detailsLoading = !state.loadError;
  renderAll();
  if (state.loadError) return;

  for (const ex of state.exercises) loadCoach(ex.id);
  const fortnight = new Set(daysBack(14));
  try {
    await loadDetails(state.workouts.filter((w, i) => i < 3 || fortnight.has(w.performed_on)).map((w) => w.id));
  } catch {
    // the lists are already on screen; volume stays unknown
  }
  state.detailsLoading = false;
  renderStats();
  renderCoach();
  renderRecent();
  renderWorkouts();
}

function renderAll() {
  renderExercises();
  renderWorkouts();
  renderHome();
  renderLogState();
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
  if (serviceDown.workouts) messages.push("Workouts is unavailable, so logging and history are paused.");
  if (serviceDown.progress) messages.push("Progress is unavailable, so next-session suggestions are paused.");
  banner.hidden = messages.length === 0;
  if (messages.length) put(banner, icon("alert"), el("span", {}, `${messages.join(" ")} Everything else still works.`));
}

// --- home: greeting, weekly stats, coach, recent -------------------------------------------

function renderGreeting() {
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  document.getElementById("greeting").textContent = `Good ${part}`;
}

const volumeOf = (w) => {
  const detail = state.details.get(w.id);
  return detail ? detail.sets.reduce((m, s) => m + s.weight_kg * s.reps, 0) : 0;
};

function renderStats() {
  const week = daysBack(7);
  const before = new Set(daysBack(7, 7));
  const thisWeek = state.workouts.filter((w) => week.includes(w.performed_on));
  const lastWeek = state.workouts.filter((w) => before.has(w.performed_on));
  const setsPerDay = week.map((day) => thisWeek.filter((w) => w.performed_on === day).reduce((n, w) => n + w.set_count, 0));
  const totalSets = setsPerDay.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...setsPerDay);
  const today = isoDay(new Date());

  const bars = el("div", { class: "bars", role: "img",
    "aria-label": `Sets per day, last 7 days: ${week.map((d, i) => `${formatDate(d)} ${setsPerDay[i]}`).join(", ")}` },
    ...week.map((day, i) => el("div", { class: `bar${setsPerDay[i] ? " has" : ""}${day === today ? " today" : ""}` },
      el("i", { style: `height:${Math.max(6, (setsPerDay[i] / max) * 100)}%` }),
      el("span", {}, letterFmt.format(toDate(day))))));

  const volume = thisWeek.reduce((n, w) => n + volumeOf(w), 0);
  const previous = lastWeek.reduce((n, w) => n + volumeOf(w), 0);
  let trend = null;
  if (!state.detailsLoading && volume > 0 && previous > 0) {
    const change = Math.round(((volume - previous) / previous) * 100);
    const kind = change > 2 ? "up" : change < -2 ? "down" : "flat";
    trend = el("span", { class: `trend ${kind}` }, icon(kind === "up" ? "up" : kind === "down" ? "down" : "hold"),
      kind === "flat" ? "Same as last week" : `${Math.abs(change)}% ${kind === "up" ? "more" : "less"} than last week`);
  }
  const last = state.workouts[0];
  const busy = state.loading || state.detailsLoading;

  put(document.getElementById("stat-cards"),
    el("div", { class: "stat", role: "group", "aria-label": "Sets this week" },
      el("div", { class: "stat-top" }, el("span", { class: "stat-icon" }, icon("stack")), "Sets"),
      el("p", { class: "stat-value" }, state.loading ? "-" : String(totalSets), el("small", {}, "sets")),
      bars),
    el("div", { class: "stat", role: "group", "aria-label": "Volume this week" },
      el("div", { class: "stat-top" }, el("span", { class: "stat-icon" }, icon("weight")), "Volume"),
      el("p", { class: "stat-value" }, busy ? "-" : compact.format(volume), el("small", {}, "kg lifted")),
      trend,
      el("p", { class: "stat-hint" }, state.loading ? "Loading" : last ? `Last session ${formatDate(last.performed_on)}` : "No sessions yet")),
  );
}

const ACTION = {
  increase_weight: { label: "Add weight", icon: "up" },
  add_reps: { label: "Add a rep", icon: "plus" },
  deload: { label: "Deload", icon: "down" },
  no_history: { label: "First session", icon: "spark" },
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

// the top weight logged for this exercise on the day the suggestion is based on
function basedOnWeight(rec) {
  for (const w of state.workouts) {
    const detail = state.details.get(w.id);
    if (!detail || w.performed_on !== rec.based_on) continue;
    const weights = detail.sets.filter((s) => s.exercise_id === rec.exercise_id).map((s) => s.weight_kg);
    if (weights.length) return Math.max(...weights);
  }
  return null;
}

function renderCoach() {
  const card = document.getElementById("coach");
  const chips = document.getElementById("coach-chips");
  const body = document.getElementById("coach-body");
  if (!exerciseById(coachExerciseId)) coachExerciseId = state.exercises[0]?.id ?? null;
  put(chips, ...state.exercises.map((ex) =>
    el("button", {
      type: "button", role: "tab", class: "chip", "aria-controls": "coach-body",
      "aria-selected": String(ex.id === coachExerciseId),
      onclick: () => { coachExerciseId = ex.id; renderCoach(); },
    }, ex.name)));
  delete card.dataset.action;
  const ex = exerciseById(coachExerciseId);
  if (!ex) {
    if (state.loading) {
      return put(body, el("span", { class: "skeleton title" }), el("span", { class: "skeleton big" }), el("span", { class: "skeleton line" }));
    }
    const message = state.loadError ? `${state.loadError} Suggestions come back as soon as it does.`
      : "Add an exercise and log a session to get your first suggestion.";
    return put(body,
      el("h3", { class: "coach-name" }, "Your coach"),
      el("p", { class: "coach-reason" }, message),
      state.loadError ? null : el("div", { class: "coach-foot" }, el("span", {}),
        el("a", { href: "#exercises", class: "coach-cta" }, "Add exercise", icon("arrow"))));
  }
  const rec = state.coach.get(ex.id);
  if (!rec) loadCoach(ex.id);
  if (!rec || rec.loading) {
    return put(body, el("h3", { class: "coach-name" }, ex.name), el("span", { class: "skeleton big" }), el("span", { class: "skeleton line" }));
  }
  if (rec.error) {
    return put(body,
      el("h3", { class: "coach-name" }, ex.name),
      el("p", { class: "coach-reason" }, rec.error),
      el("div", { class: "coach-foot" }, el("span", {}),
        el("button", { type: "button", class: "coach-cta", onclick: () => { state.coach.delete(ex.id); renderCoach(); } }, "Try again")));
  }
  const action = ACTION[rec.action] ?? { label: rec.action, icon: "spark" };
  card.dataset.action = rec.action;
  const top = rec.based_on ? basedOnWeight(rec) : null;
  const evidence = !rec.based_on ? `Rep range ${ex.rep_range_min}-${ex.rep_range_max}`
    : top !== null ? `From your ${kg(top)} kg ${rec.sets === 1 ? "set" : "sets"} on ${formatDate(rec.based_on)}`
    : `From ${formatDate(rec.based_on)}`;
  put(body,
    el("span", { class: "coach-badge" }, icon(action.icon), action.label),
    el("h3", { class: "coach-name" }, ex.name),
    rec.weight_kg === null ? null : el("p", { class: "coach-target", "aria-label": `${rec.weight_kg} kg for ${rec.target_reps} reps, ${plural(rec.sets, "set")}` },
      kg(rec.weight_kg), el("small", {}, "kg"), el("span", { class: "times", "aria-hidden": "true" }, "×"), String(rec.target_reps), el("small", {}, "reps"),
      rec.sets ? el("span", { class: "coach-sets" }, plural(rec.sets, "set")) : null),
    el("p", { class: "coach-reason" }, rec.reason),
    el("div", { class: "coach-foot" },
      el("span", {}, evidence),
      el("button", { type: "button", class: "coach-cta", onclick: () => logFromCoach(ex, rec) },
        rec.weight_kg === null ? "Log first session" : "Log this session", icon("arrow"))),
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
      el("span", { class: "month" }, monthFmt.format(date))),
    el("div", { class: "grow" },
      el("strong", {}, names || w.notes || formatDate(w.performed_on)),
      el("span", { class: "meta" }, plural(w.set_count, "set"), names && w.notes ? `, ${w.notes}` : "")),
  ];
}

function statusItem(text, retry) {
  return el("li", { class: "empty card" }, text, retry
    ? el("div", {}, el("button", { type: "button", class: "ghost small retry", onclick: retry }, "Try again"))
    : null);
}

function loadingRows(n) {
  return Array.from({ length: n }, () => el("li", { "aria-hidden": "true" },
    el("div", { class: "loading-row" }, el("span", { class: "sk badge" }), el("span", { class: "sk text" }))));
}

function retryLoad() {
  state.loading = true;
  renderAll();
  loadAll();
}

function renderRecent() {
  const list = document.getElementById("recent-list");
  if (state.loading) return put(list, ...loadingRows(3));
  if (state.loadError) return put(list, statusItem(state.loadError, retryLoad));
  if (state.workouts.length === 0) return put(list, statusItem("No workouts yet. Tap Log to add your first."));
  put(list, ...state.workouts.slice(0, 3).map((w) =>
    el("li", {}, el("a", { href: "#history", class: "recent-item" }, ...workoutSummary(w),
      el("span", { class: "chevron" }, icon("chevron"))))));
}

function renderHome() {
  renderStats();
  renderCoach();
  renderRecent();
}

// --- exercises -----------------------------------------------------------------------------

function renderExercises() {
  const list = document.getElementById("exercise-list");
  if (state.loading) put(list, el("li", { class: "empty" }, "Loading exercises..."));
  else if (state.loadError) put(list, statusItem(state.loadError, retryLoad));
  else if (state.exercises.length === 0) put(list, statusItem("No exercises yet. Add your first one below."));
  else {
    put(list, ...state.exercises.map((ex) =>
      el("li", { class: ex.id === editingExerciseId ? "editing" : "" },
        el("div", { class: "grow" },
          el("strong", {}, ex.name),
          el("span", { class: "meta" }, `${ex.rep_range_min}-${ex.rep_range_max} reps`)),
        el("span", { class: `body-tag ${ex.body_part}` }, ex.body_part === "upper" ? "Upper" : "Lower"),
        el("button", { type: "button", class: "ghost small", onclick: () => editExercise(ex.id) }, "Edit"),
        confirmButton("Delete", "Confirm", (button) => deleteExercise(ex.id, button)),
      )));
  }
  for (const select of document.querySelectorAll('select[name="exercise_id"]')) fillExerciseSelect(select);
}

function fillExerciseSelect(select) {
  const current = select.value;
  if (state.loading) {
    select.disabled = true;
    return put(select, el("option", { value: "" }, "Loading exercises..."));
  }
  select.disabled = state.exercises.length === 0;
  put(select, ...state.exercises.map((ex) => el("option", { value: ex.id }, ex.name)));
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
  // the service refuses (409, with a readable message) if any workout uses it
  const done = await withButton(button, "Deleting...", async () => {
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
  const saved = await withButton(document.getElementById("save-exercise"), "Saving...", () =>
    wasEditing ? api.updateExercise(wasEditing, exercise) : api.createExercise(exercise));
  if (!saved) return;
  toast(wasEditing ? `Saved ${saved.name}.` : `Added ${saved.name}.`);
  resetExerciseForm();
  await loadAll();
});

document.getElementById("cancel-exercise-edit").addEventListener("click", resetExerciseForm);

// --- log or edit a workout -----------------------------------------------------------------

function renderLogState() {
  const noExercises = !state.loading && !state.loadError && state.exercises.length === 0;
  document.getElementById("log-hint").hidden = !noExercises;
  const logError = document.getElementById("log-error");
  logError.hidden = !state.loadError;
  logError.textContent = state.loadError ? `${state.loadError} You can log again once it's back.` : "";
  const save = document.getElementById("save-workout");
  if (save.classList.contains("busy")) return;
  save.disabled = state.loading || noExercises || Boolean(state.loadError);
  save.textContent = state.loading ? "Loading exercises..." : editingWorkoutId ? "Save changes" : "Save workout";
}

// sets are numbered per exercise, like the service numbers them
function renumberSets() {
  const rows = [...document.querySelectorAll(".set-row")];
  const seen = new Map();
  for (const row of rows) {
    const id = row.querySelector("select").value;
    seen.set(id, (seen.get(id) ?? 0) + 1);
    row.querySelector(".set-no").textContent = String(seen.get(id));
  }
  for (const row of rows) {
    const remove = row.querySelector(".remove-set");
    remove.disabled = rows.length === 1;
    remove.title = rows.length === 1 ? "A workout needs at least one set" : "Remove set";
  }
}

function addSetRow(values = {}) {
  const row = document.getElementById("set-row").content.firstElementChild.cloneNode(true);
  const select = row.querySelector("select");
  fillExerciseSelect(select);
  if (values.exercise_id) select.value = values.exercise_id;
  if (values.weight_kg !== undefined) row.querySelector('[name="weight_kg"]').value = values.weight_kg;
  if (values.reps !== undefined) row.querySelector('[name="reps"]').value = values.reps;
  const remove = row.querySelector(".remove-set");
  remove.append(icon("x"));
  remove.addEventListener("click", () => {
    if (document.querySelectorAll(".set-row").length > 1) { row.remove(); renumberSets(); }
  });
  select.addEventListener("change", renumberSets);
  document.getElementById("set-rows").append(row);
  renumberSets();
}

function renderDateReadout() {
  const value = document.getElementById("log-form").performed_on.value;
  document.getElementById("date-readout").textContent = value ? longFmt.format(toDate(value)) : "";
}
document.getElementById("log-form").performed_on.addEventListener("input", renderDateReadout);

function resetLogForm() {
  editingWorkoutId = null;
  const form = document.getElementById("log-form");
  form.reset();
  form.performed_on.value = isoDay(new Date());
  document.getElementById("set-rows").replaceChildren();
  addSetRow();
  document.getElementById("log-heading").textContent = "Log a workout";
  document.getElementById("cancel-workout-edit").hidden = true;
  renderDateReadout();
  renderLogState();
}

async function editWorkout(id, button) {
  const ok = await withButton(button, "Opening...", async () => {
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
  document.getElementById("cancel-workout-edit").hidden = false;
  renderDateReadout();
  renderLogState();
  go("log");
}

async function deleteWorkout(id, button) {
  const done = await withButton(button, "Deleting...", async () => {
    await api.deleteWorkout(id);
    return true;
  });
  if (!done) return;
  if (editingWorkoutId === id) resetLogForm();
  toast("Workout deleted.");
  await loadAll();
}

document.getElementById("add-set").prepend(icon("plus"));
document.getElementById("add-set").addEventListener("click", () => {
  // start the new row from the previous one: same exercise and weight is the usual next set
  const rows = document.querySelectorAll(".set-row");
  const prev = rows[rows.length - 1];
  addSetRow(prev ? {
    exercise_id: prev.querySelector("select").value,
    weight_kg: prev.querySelector('[name="weight_kg"]').value,
  } : {});
  document.querySelector(".set-row:last-child [name='reps']").focus();
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
  const saved = await withButton(document.getElementById("save-workout"), "Saving...", () =>
    wasEditing ? api.updateWorkout(wasEditing, workout) : api.createWorkout(workout));
  if (!saved) return;
  resetLogForm();
  go(wasEditing ? "history" : "home");
  toast(wasEditing
    ? `Saved changes to ${formatDate(saved.performed_on)}.`
    : `Saved ${plural(saved.sets.length, "set")} for ${formatDate(saved.performed_on)}.`);
  await loadAll();
});

// --- history -------------------------------------------------------------------------------

function workoutBody(w) {
  const detail = state.details.get(w.id);
  if (!detail) return el("p", { class: "muted" }, "Loading sets...");
  return el("div", {},
    detail.notes ? el("p", { class: "note" }, detail.notes) : null,
    el("table", { class: "set-table" },
      el("tbody", {}, ...detail.sets.map((s) =>
        el("tr", {},
          el("td", {}, s.exercise_name),
          el("td", { class: "muted" }, `Set ${s.set_number}`),
          el("td", { class: "right mono" }, el("strong", {}, `${kg(s.weight_kg)} kg`), ` × ${s.reps}`))))),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "ghost small", onclick: (e) => editWorkout(w.id, e.currentTarget) }, "Edit"),
      confirmButton("Delete", "Confirm delete", (button) => deleteWorkout(w.id, button))));
}

// sets of older workouts are fetched the first time the row is opened
async function onToggle(event, w) {
  const details = event.currentTarget;
  if (!details.open || state.details.has(w.id)) return;
  try {
    await loadDetails([w.id]);
  } catch (error) {
    put(details.querySelector(".workout-body"), el("p", { class: "muted" }, error.message));
    return;
  }
  put(details.querySelector("summary"), ...workoutSummary(w), el("span", { class: "chevron" }, icon("chevron")));
  put(details.querySelector(".workout-body"), workoutBody(w));
}

function renderWorkouts() {
  const list = document.getElementById("workout-list");
  if (state.loading) return put(list, ...loadingRows(4));
  if (state.loadError) return put(list, statusItem(state.loadError, retryLoad));
  if (state.workouts.length === 0) return put(list, statusItem("No workouts yet. Tap Log to add your first."));
  const open = new Set([...list.querySelectorAll("details[open]")].map((d) => d.dataset.id));
  put(list, ...state.workouts.map((w) => {
    const details = el("details", { class: "card", "data-id": String(w.id), ontoggle: (e) => onToggle(e, w) },
      el("summary", {}, ...workoutSummary(w), el("span", { class: "chevron" }, icon("chevron"))),
      el("div", { class: "workout-body" }, workoutBody(w)));
    if (open.has(String(w.id))) details.open = true;
    return el("li", {}, details);
  }));
}

// --- start ---------------------------------------------------------------------------------

renderGreeting();
resetLogForm();
renderAll();
showView(location.hash.slice(1));
loadAll();
checkHealth("workouts", workoutsUrl);
checkHealth("progress", progressUrl);
