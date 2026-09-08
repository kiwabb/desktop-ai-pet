# Backend Guidelines

The independent Python service lives in `server/`. Tauri clients do not install or start Python.

- [Server-agent contract](server-agent.md): persistence, authentication, event ordering and verification.
- [Admin control-plane contract](admin-control-plane.md): admin roles, encrypted model versions, audit boundaries and run traces.
- [Setup](../../../server/README.md): environment, migrations and device provisioning.

- [Todo reminders](todo-reminders.md): explicit schedule/CAS, due polling, client actions and offline boundaries.
