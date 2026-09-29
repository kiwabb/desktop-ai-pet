# Research: Backend startup and model proxy boundary

- Query: Confirm the existing startup entry for the desktop pet backend and its relationship to the configured model service on port 8080 after the user explicitly requested stopping EAPAI and starting the backend.
- Scope: internal; read-only source research, with process/container findings supplied by the main session.
- Date: 2026-09-14

## Findings

### Files found

Eight repository files were inspected; no `.env`, credentials, database secrets, generated code, or unrelated source files were opened:

1. `.trellis/workflow.md` — task context, persistence, and phase rules.
2. `.trellis/tasks/09-14-companion-product-refactor/prd.md` — existing service/data requirement and prohibition on inventing a replacement model service.
3. `.trellis/tasks/09-14-companion-product-refactor/design.md` — use real existing services and distinguish evidence levels.
4. `.trellis/tasks/09-14-companion-product-refactor/implement.md` — native and real-environment acceptance remains incomplete.
5. `.trellis/spec/backend/server-agent.md` — public API, server-owned model configuration, and verification boundaries.
6. `server/README.md` — documented backend startup and dependency ports.
7. `server/compose.yaml` — this repository manages only the pet Redis container.
8. `server/app/config.py` — separate server dependency and model-provider settings.

### Executable basis and code patterns

- `server/README.md:15` assigns shared PostgreSQL to host port 15433, pet Redis to 16380, and the pet API to **18081**. The pet API is not the model proxy on 8080.
- `server/README.md:21` documents the existing API command, run from `server/`: `uv run uvicorn app.main:app --host 127.0.0.1 --port 18081 --no-access-log`.
- `server/README.md:18` and `server/README.md:19` document `docker compose config --quiet` and `docker compose up -d` for the pet dependency compose project. `server/compose.yaml:2` contains only Redis; it does not start a model service, proxy, PostgreSQL, or API process.
- `server/app/config.py:9` reads the existing `PET_AGENT_` configuration from the service working directory. `server/app/config.py:13` through `server/app/config.py:15` define the provider base URL, API key, and model independently of the API listening port.
- `server/README.md:68` through `server/README.md:72` describe managed model versions and binding accepted runs to a selected version. `server/README.md:81` states that managed configuration failures do not silently fall back to environment settings.
- `server/README.md:24` explicitly distinguishes `/health` reporting model configuration from an actual successful model invocation.

### Current runtime findings supplied by main session

The main session reported independently verifying that the pet API on 18081 is already healthy; the process on 8080 is PID 55029 with EAPAI backend cwd; stopped existing `sub2api` and `sub2api-redis` containers exist; and `sub2api` maps `127.0.0.1:8080` to container 8080 with compose working directory `/Users/zhoujiaangyao/zhoujiangyao/AI/sub2api/deploy`. These runtime findings were not re-probed by this researcher.

The source-grounded service boundary is therefore: pet desktop → pet API **18081** → separately configured model provider/proxy **8080**. Stopping EAPAI and starting the existing sub2api dependency/container restores the intended listener without moving the pet API onto 8080 or changing its model configuration. The parent owns those process/container actions and their verification.

### External references

No web references were needed for this local startup question. Repository documentation identifies Python 3.12 + FastAPI (`server/README.md:3`); the compose image is `redis:7.4-alpine` (`server/compose.yaml:4`). No dependency versions were changed.

### Related specs

- `.trellis/spec/backend/server-agent.md:9`: `/health` exposes dependency state and configuration presence without credentials.
- `.trellis/spec/backend/server-agent.md:30`: model credentials and settings belong to the server.
- `.trellis/spec/backend/server-agent.md:77` through `.trellis/spec/backend/server-agent.md:78`: real-model verification is distinct from service availability and isolated checks.

## Caveats / Not Found

- No model proxy startup entry exists in the inspected pet README or compose file. The existing sub2api installation is outside this repository, identified by the main session's live container inspection.
- Research role isolation forbids reading `implement.jsonl` and `check.jsonl`; no research-specific JSONL manifest was present. Necessary PRD/design/implementation context was read directly.
- This researcher did not stop/start processes, modify configuration, invoke a model, log into admin, or write business records.
- A healthy proxy or an authenticated route being present does not establish successful generated model output. That acceptance requires a real supported request and verified response in the main session.
