# Sprint 1 (11–18 Nov 2026)

## Roles

- Product Owner: Emma
- Scrum Master: Raji
- Developers: Raji, Lorenzo, Emma, David (David joined during the sprint)

## Planning (11 Nov, in class)

**Sprint Goal (planned):** the skeleton deployed to Azure by the pipeline, then the first core feature end to end.

**Sprint Goal (reset on 17 Nov):** the platform is live on Azure, the team is set up, and the first feature PRs are open. We reset it because the group's Azure resource group had not arrived and no feature work had started.

Items selected. The Product Backlog was only created as GitHub issues on 18 Nov (see Retrospective), so these are the issues for the work planned in the team plan:

- [x] #5 Repository, branch protection and CI check
- [x] #6 Project skeleton runs locally
- [x] #7 Sprint 0 record
- [ ] #8 Deploy to Azure by the pipeline
- [ ] #9 Manage exercises
- [ ] #10 Log a workout with sets
- [ ] #11 Exercise history endpoint
- [ ] #12 Next-session coach
- [ ] #13–#16 UI: log a workout, browse workouts, manage exercises, next-session card

## Review (18 Nov, in the group chat)

Done:

- #5 Repository, branch protection and the required `ci` check (PR #1, 13 Nov).
- #6 Project skeleton: both services, compose, `/health`, request logs, migrations on startup, pipeline, Bicep and docs templates (PR #2, 14 Nov). Runs locally from a clean clone.
- #7 Sprint 0 record (PR #4, 18 Nov).
- Product Backlog: 25 issues (#5–#29) with user stories and acceptance criteria, prioritised, on the team's GitHub Project board (18 Nov).

Merged but not deployed, so not done under our Definition of Done:

- #12 Next-session coach (PR #3, reviewed and approved by Emma, merged 18 Nov). The skeleton (#6) is in the same situation.

Not done (and why, and where it goes):

- #8 Deploy to Azure: the course resource group and the group's service principal had not been provided by the end of the sprint. The professor said to use our own resource group for now. Emma's Azure for Students subscription only allows regions where Static Web Apps are not available, so the UI cannot be deployed there; Raji, as repo admin, is setting up the deployment on his subscription. Moves to Sprint 2, first priority.
- #9, #10, #11 Workouts API: PR #30 is open and reviewed (merge conflict and two small comments to address). Built by Raji instead of Lorenzo so the UI and coach could start; issues reassigned to Raji. Moves to Sprint 2.
- #13–#16 UI: draft PR #31 has the full page on sample data in the API's exact shapes. Wiring each section to the API depends on #9–#11 (PR #30) and moves to Sprint 2.

Stakeholder feedback:

- None this sprint.

## Retrospective

- Went well: the skeleton, CI and Bicep were solid from day one; Raji unblocked the team by building the coach and the workouts API; the Product Backlog and board are now in place.
- To improve: we started late; Azure access was not chased early enough; work was not spread evenly across the team.
- **Agreement for next sprint:** a daily check-in message in the group chat (yesterday, today, blocked), and any issue with no PR by its planned day is reassigned at the next check-in.

Impediments:

- 18 Nov: the course resource group and service principal were not available; our own Azure for Students subscription blocks Static Web Apps by region.
- A teammate (David) joined during the sprint.
- Roles and the backlog were only set up on the last day of the sprint.
