// Skeleton: shows whether each service answers /health. Each check gives up after 5 s
// so a service that is down shows a message instead of a request that hangs.
const TIMEOUT_MS = 5000;

async function checkHealth(name, baseUrl) {
  const label = document.querySelector(`[data-service="${name}"] span`);
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await response.json();
    label.textContent = response.ok ? `up (version ${body.version})` : "database unavailable";
    label.className = response.ok ? "ok" : "down";
  } catch (error) {
    label.textContent = error.name === "TimeoutError"
      ? "not answering (it may be waking up; refresh in a minute)"
      : "unreachable";
    label.className = "down";
  }
}

const { workoutsUrl, progressUrl } = window.LIFTLOG_CONFIG;
checkHealth("workouts", workoutsUrl);
checkHealth("progress", progressUrl);
