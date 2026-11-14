# Migrations

Versioned SQL files applied on startup by `app/db.py:migrate`, in name order, each in one
transaction with its row in `schema_migrations`.

- Name them `001_init.sql`, `002_add_notes.sql`, ...
- Separate batches with a line containing only `GO`.
- Never edit a file after it has run anywhere (local, CI or Azure). A change is a new file.
- Keep `docs/data-model.md` in sync with what these files create.
