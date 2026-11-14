// Where the UI finds the two services. These are the local docker compose ports;
// the CD pipeline overwrites this file with the Azure URLs before deploying the UI.
window.LIFTLOG_CONFIG = {
  workoutsUrl: "http://localhost:8001",
  progressUrl: "http://localhost:8002",
};
