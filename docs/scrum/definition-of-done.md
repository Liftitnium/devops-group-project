# Definition of Done

An item is done only when **all** of these are true:

1. The acceptance criteria of the user story are met.
2. It reached `main` through a pull request approved by another team member (no direct pushes).
3. CI is green: lint, format, tests, coverage ≥ 70% on core logic, dependency audit, secrets scan, image build.
4. New logic has tests; bugs fixed have a test that failed before the fix.
5. It is deployed to Azure by the pipeline, and the post-deploy health check passed.
6. Schema changes are a new migration file, and `docs/data-model.md` matches it.
7. Docs touched by the change are updated (README, decisions, API notes).
8. Significant AI-assisted work has a row in `AI_USAGE.md`.
9. No secrets in the code, the history or the logs.
