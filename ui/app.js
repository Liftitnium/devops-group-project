// LiftLog UI. Layout with sample data (window.SAMPLE); each section is wired to the
// services in its own PR (#13 log, #14 workouts, #15 exercises, #16 next session).
// Text from the data is always set with textContent, never innerHTML, so a workout note
// can't inject HTML into the page.

const TIMEOUT_MS = 5000;
const { workoutsUrl, progressUrl } = window.LIFTLOG_CONFIG;
const state = structuredClone(window.SAMPLE);

// --- small helpers ---------------------------------------------------------------------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function showMessage(id, text, kind = "ok") {
  const node = document.getElementById(id);
  node.textContent = text;
  node.className = `message ${kind}`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const formatDate = (iso) => dateFormat.format(new Date(`${iso}T00:00:00`));

// --- service status (from the skeleton) --------------------------------------------------
// Each check gives up after 5 s, so a service that is down shows a message instead of
// a request that hangs.

async function checkHealth(name, baseUrl) {
  const label = document.querySelector(`[data-service="${name}"] span`);
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await response.json();
    label.textContent = response.ok ? `up (${body.version})` : "database unavailable";
    label.className = response.ok ? "ok" : "down";
  } catch (error) {
    label.textContent = error.name === "TimeoutError" ? "not answering (may be waking up)" : "unreachable";
    label.className = "down";
  }
}

// --- exercises ---------------------------------------------------------------------------

function renderExercises() {
  const list = document.getElementById("exercise-list");
  list.replaceChildren(
    ...state.exercises.map((ex) =>
      el("li", {},
        el("span", { class: "grow" },
          el("strong", {}, ex.name),
          ` · ${ex.body_part} body · ${ex.rep_range_min}–${ex.rep_range_max} reps`),
        el("button", { type: "button", class: "secondary", disabled: "" }, "Edit"),
        el("button", { type: "button", class: "secondary", disabled: "" }, "Delete"),
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
  if (current) select.value = current;
}

document.getElementById("exercise-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const min = Number(form.get("rep_range_min"));
  const max = Number(form.get("rep_range_max"));
  if (min > max) {
    showMessage("exercise-message", "The lowest rep count must not be higher than the highest.", "down");
    return;
  }
  // sample only: kept in the page, not saved (#15 sends it to POST /exercises)
  const id = Math.max(0, ...state.exercises.map((ex) => ex.id)) + 1;
  state.exercises.push({ id, name: form.get("name").trim(), body_part: form.get("body_part"), rep_range_min: min, rep_range_max: max });
  state.exercises.sort((a, b) => a.name.localeCompare(b.name));
  renderExercises();
  event.target.reset();
  showMessage("exercise-message", "Added to the sample list (not saved yet).");
});

// --- log a workout -------------------------------------------------------------------------

function addSetRow() {
  const row = document.getElementById("set-row").content.firstElementChild.cloneNode(true);
  fillExerciseSelect(row.querySelector("select"));
  row.querySelector(".remove-set").addEventListener("click", () => {
    if (document.querySelectorAll(".set-row").length > 1) row.remove();
  });
  document.getElementById("set-rows").append(row);
}

document.getElementById("add-set").addEventListener("click", addSetRow);

document.getElementById("log-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  const sets = [...form.querySelectorAll(".set-row")].map((row) => ({
    exercise_id: Number(row.querySelector('[name="exercise_id"]').value),
    weight_kg: Number(row.querySelector('[name="weight_kg"]').value),
    reps: Number(row.querySelector('[name="reps"]').value),
  }));
  // sample only: the body below is exactly what #13 will POST to /workouts
  const workout = { performed_on: form.performed_on.value, notes: form.notes.value.trim(), sets };
  const id = Math.max(0, ...state.workouts.map((w) => w.id)) + 1;
  state.workouts.unshift({ id, performed_on: workout.performed_on, notes: workout.notes, set_count: sets.length });
  state.workouts.sort((a, b) => b.performed_on.localeCompare(a.performed_on));
  renderWorkouts();
  showMessage("log-message", `Added a workout with ${sets.length} set(s) to the sample list (not saved yet).`);
});

// --- past workouts -------------------------------------------------------------------------

function renderWorkouts() {
  const list = document.getElementById("workout-list");
  if (state.workouts.length === 0) {
    list.replaceChildren(el("li", { class: "empty" }, "No workouts yet. Log your first one above."));
    return;
  }
  list.replaceChildren(
    ...state.workouts.map((w) =>
      el("li", {},
        el("span", { class: "grow" },
          el("strong", {}, formatDate(w.performed_on)),
          ` · ${w.set_count} set${w.set_count === 1 ? "" : "s"}`,
          w.notes ? el("span", { class: "notes" }, ` · ${w.notes}`) : ""),
        el("button", { type: "button", class: "secondary", disabled: "" }, "Edit"),
        el("button", { type: "button", class: "secondary", disabled: "" }, "Delete"),
      ),
    ),
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
  const rec = state.nextSession[exerciseId];
  if (!rec) {
    card.className = "card";
    card.replaceChildren(el("p", {}, "No suggestion for this exercise in the sample data."));
    return;
  }
  card.className = `card action-${rec.action}`;
  card.replaceChildren(
    el("p", { class: "badge" }, ACTION_LABEL[rec.action] ?? rec.action),
    rec.weight_kg === null
      ? ""
      : el("p", { class: "target" }, `${rec.weight_kg} kg × ${rec.target_reps} reps`, el("small", {}, ` for ${rec.sets} sets`)),
    el("p", {}, rec.reason),
    rec.based_on ? el("p", { class: "muted" }, `Based on ${formatDate(rec.based_on)}`) : "",
  );
}

document.getElementById("next-exercise").addEventListener("change", (event) => renderNextSession(event.target.value));

// --- start ---------------------------------------------------------------------------------

document.querySelector('#log-form [name="performed_on"]').valueAsDate = new Date();
renderExercises();
addSetRow();
renderWorkouts();
renderNextSession(document.getElementById("next-exercise").value);
checkHealth("workouts", workoutsUrl);
checkHealth("progress", progressUrl);
