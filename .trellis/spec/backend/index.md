# Backend Guidelines

The independent Python service lives in `server/`. Tauri clients do not install or start Python.

- [Server-agent contract](server-agent.md): persistence, authentication, event ordering and verification.
- [Setup](../../../server/README.md): environment, migrations and device provisioning.

- [Todo reminders](todo-reminders.md): explicit schedule/CAS, due polling, client actions and offline boundaries.
