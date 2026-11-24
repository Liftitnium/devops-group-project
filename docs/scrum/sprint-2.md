# Sprint 2 (19–24 Nov 2026)

## Roles

- Product Owner: Raji
- Scrum Master: Emma
- Developers: Raji, Lorenzo, Emma, David

## Planning (19 Nov, in the group chat)

**Sprint Goal:** LiftLog is complete and live on the course Azure, deployed by the pipeline, with personal records, goals, the dashboard, the SLO and the docs. Tag `submission` by Tue 24 Nov 20:00.

This is the last sprint, so every open Product Backlog item is in it. Raji (PO) posted the plan with an owner and a day for each item; nobody asked to change it.

Items selected:

- [ ] #8 Deploy to Azure by the pipeline (Raji, Fri 20). Everything that needs the live URL depends on it.
- [ ] #17 Clear message when a service is down (Emma, Fri 20)
- [ ] #21 Goals (David, Fri 20)
- [ ] #18 Request logs and dashboard in Log Analytics (Raji, Sat 21)
- [ ] #19 SLO with its query (Raji, Sat 21)
- [ ] #20 Personal records (David, Sat 21)
- [ ] #22 UI: personal records board and goals (Emma, Sun 22, needs #20 and #21)
- [ ] #23 Smoke test against the deployed URL (Raji, Sun 22)
- [ ] #24 Data model doc matches migrations (Lorenzo workouts half by Fri 20, David progress half by Sun 22)
- [ ] #26 README complete (Emma, from Fri 20)
- [ ] #25 Decision records (Emma ADR-6 frontend, Raji ADR-3/4, Mon 23)
- [ ] #28 AI_USAGE.md complete (everyone writes the last column of their own rows, Mon 23)
- [ ] #27 Sprint 1 and Sprint 2 records (Emma, Tue 24)
- [ ] #29 Tag the submission (Emma and Raji, Tue 24 by 20:00)

Working agreements for this sprint:

- From the Sprint 1 retro: post a daily check-in in the group chat (yesterday, today, blocked).
- Open a draft PR on the day you start an item.
- Mon 23 is feature freeze: only fixes after that, plus a demo rehearsal in the evening where each of us presents the part we built.

## Review (24 Nov, on a call)

The Sprint Goal was met: LiftLog is live on the course Azure at
https://wonderful-grass-0928c6b03.6.azurestaticapps.net, deployed by the pipeline, with
personal records, goals, the dashboard and the SLO.

Done (merged, deployed and checked against the acceptance criteria):

- #8 Deploy to Azure by the pipeline: every merge to `main` builds images tagged with the
  commit SHA, updates both Container Apps and the UI, waits for `/health` to report the new
  SHA, then runs the smoke test. Sign-in to Azure uses OIDC, with no stored secret (PRs #37,
  #39, first green deploy with PR #45, 21 Nov).
- #17 Clear message when a service is down: every page says what is wrong in plain words and
  keeps working where it can; the Log page explains why saving is off (PR #35).
- #18 Request logs and dashboard: one JSON log line per request, and the dashboard queries
  are deployed as saved queries in Log Analytics (PR #38).
- #19 SLO: 99% of GET requests to the workouts API answered without a server error in under
  500 ms over 7 days, in the README, with its query in `monitoring/queries.kql` (PR #38).
- #20 Personal records: heaviest weight per rep count, worked out from the workouts history
  (PR #43, David).
- #21 Goals: create, edit, delete, and how close each goal is (PR #34, David).
- #22 UI for personal records and goals: the Progress tab (PR #44, Emma).
- #23 Smoke test against the deployed API, run after every deploy (PR #39, Raji).
- #24 Data model doc matches the migrations: progress half by David (PR #46), workouts half
  by Lorenzo (PR #50).
- #25 Decision records: six ADRs in `docs/decisions.md`, including ADR-6 on the frontend
  (PRs #42, #47, #57).
- #26 README complete: how to use the app, screenshot, team, live URL (PRs #41, #42, #47).

Also done, not in the plan:

- A new UI look and a QA pass, with a two-column layout on desktop (PR #33, Raji).
- Each service connects to its database as its own user instead of the admin, and the API
  has no sign-in by design; both are recorded in ADR-2 and ADR-1 (PRs #37 and #57, Raji).
- The coach's wording follows the number of sets (PR #40, Raji).
- The UI waits for services that are waking up on Azure instead of showing errors on the
  first visit (PR #48, Emma), and the workouts API refuses a workout with no sets (PR #51,
  Emma).
- Testing the live site on 24 Nov showed that logging exercise by exercise split one day into
  several workouts, and the coach then judged only the last one. Fixed on both sides: the
  history counts a day as one session (PR #55, agreed with Raji, who owns the endpoint) and
  "Log this session" adds to today's workout (PR #56, Emma).

Shown at the review:

- [x] Logging a workout and the next-session coach (Emma)
- [x] Progress tab: goals and personal records (Emma, David)
- [x] Partial failure: workouts stopped, the rest keeps working (Emma)
- [x] The pipeline: a merge deployed and smoke-tested (Raji)
- [x] #19 The SLO and the dashboard in Log Analytics (Raji)

Not done (and why, and where it goes):

- #27 this record and #29 the `submission` tag are done last, after everything above is merged.

Stakeholder feedback:

- None yet; we get the professor's feedback at the Sprint Review on 25 or 26 Nov.

## Retrospective

- Went well: every planned feature shipped and is live, and every merge to `main` is
  deployed and smoke-tested without anyone running commands by hand. Every PR needed an
  approval from someone other than its author, because branch protection requires it. Working against a written API contract
  let the UI, the coach, goals and records be built in parallel.
- To improve: work was still uneven, and some items arrived on the last day (the workouts
  half of #24 came on 23 Nov, after being due on 20 Nov). The daily check-in from the
  Sprint 1 retro was not kept by everyone. Many PRs editing `AI_USAGE.md` at once caused
  merge conflicts, and one row was lost in a merge (PR #45) and had to be restored.
- **Agreement for the next project:** each person adds their AI_USAGE row in the same PR as
  the work, and anyone resolving a conflict in a shared file checks that no one else's lines
  were dropped.
