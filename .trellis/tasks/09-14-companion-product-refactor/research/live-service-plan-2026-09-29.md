# Research: Saved service chain and original runtime restoration

- Query: Identify the desktop's saved mode, original API/provider/dependencies, and the minimum startup path needed for a real native request/reply check.
- Scope: internal; source review, allowlisted local configuration metadata, Docker/process metadata, read-only PostgreSQL queries, and a health read. Main session owns all service starts and model/UI requests.
- Date: 2026-09-29

## Findings

### Current saved configuration

The existing `/Users/zhoujiaangyao/Library/Application Support/ai.desktop.pet.juban/agent-config.json` exists. A Python reader printed only explicitly selected non-secret fields and credential-presence booleans:

| Field | Verified value |
| --- | --- |
| Active mode | `server` |
| Saved API | `http://127.0.0.1:18081` |
| Device credential | Present; value never output |
| Saved session | Present; identifier never output |
| Inactive local configuration | `http://127.0.0.1:8080/v1`, `gpt-5.6-luna`, 90 seconds, Asia/Shanghai |
| Plaintext local API key | Absent |

A separate read-only database query hashed the saved device credential internally and confirmed that its existing device is active with `control` and `node` roles, and that the saved session belongs to the same account. No credential was copied into an argument, report, log, or output. No Keychain read was required.

The original server's `Settings()` was loaded from `server/` without printing its representation or raw environment. It still selects shared PostgreSQL at `127.0.0.1:15433/pet_agent`, Redis at `127.0.0.1:16380/0`, and has the configured encryption key present. Managed configuration outranks fallback environment configuration.

The PostgreSQL connection explicitly set `default_transaction_read_only=on`; `SHOW transaction_read_only` returned `on`. The allowlisted model query returned:

| Field | Verified value |
| --- | --- |
| `management_enabled` | `true` |
| `revision` | `2` |
| `active_version_id` | `1291fa94-d7b7-4d9a-87e9-659aa234a6a3` |
| `base_url` | `http://127.0.0.1:8080/v1` |
| `model_name` | `gpt-5.6-luna` |
| `timeout_seconds` | `90` |
| Key reference | Present; no ciphertext or key selected |

### Initial service state and persistence

Before restoration, `lsof` found no listeners on 18081, 8080, or 16380. Shared PostgreSQL was already healthy and listening on 15433. Thus the saved native service chain was unavailable; there was no current conflicting EAPAI listener.

| Existing service | Initial state | Original persistence / connection |
| --- | --- | --- |
| `desktop-pet-agent-redis-1` | Exited | Original compose project `desktop-pet-agent`; port `127.0.0.1:16380`; existing Docker volume |
| `sub2api` | Exited | Port `127.0.0.1:8080`; existing bind `/Users/zhoujiaangyao/zhoujiangyao/AI/sub2api/deploy/data` → `/app/data` |
| `sub2api-redis` | Exited | Existing bind `/Users/zhoujiaangyao/zhoujiangyao/AI/sub2api/deploy/redis_data` → `/data` |
| `shared-postgres` | Running, healthy | Existing named volume `shared-postgres-data`; host port 15433 |

The original proxy connects to database `sub2api` via alias `postgres:5432` on `shared-postgres-network`, and to `redis:6379` on `deploy_sub2api-network`. Both aliases map to the existing containers above. The original `sub2api` database exists. No replacement database, service, account, or credential is needed.

### Original startup path and automatic effects

The minimum existing-container sequence is:

```sh
docker start desktop-pet-agent-redis-1 sub2api-redis
docker start sub2api
```

Then run from `server/`:

```sh
./.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 18081 --no-access-log
```

This uses the already installed Python 3.12.11 / uvicorn 0.52.4 environment and is equivalent to the README's `uv run uvicorn ...` entry point without dependency synchronization. Do not run `cp .env.example .env`, create-device, or recreate volumes for this restoration.

Before startup, the existing database had migrations 001–008 applied, with only `009_memos.sql` pending. This migration creates the real `memos` table and two indexes; it contains no seeded rows, updates, or deletes. `Database.open()` automatically applies pending migrations under its advisory transaction lock. Main inspected this additive migration before starting the API.

The pre-start read-only query found no `queued` or `running` agent runs, so no pending model run was waiting for the restored worker. Ordinary startup still runs existing registry/checkpoint setup and configured observability maintenance; startup is not a claim of zero database writes.

### Read-only confirmation after main restored services

Main reported starting the original containers and existing backend. This researcher independently rechecked:

- `desktop-pet-agent-redis-1`, `sub2api-redis`, `sub2api`, and `shared-postgres` are all running and healthy.
- Ports 16380 and 8080 are held by Docker; the original API process is PID `61049` on `127.0.0.1:18081`.
- `GET http://127.0.0.1:18081/health` returned HTTP 200 with `status=ok`, `database=true`, `redis=true`, `model=gpt-5.6-luna`, and `model_configured=true`.
- Read-only PostgreSQL verification confirms `009_memos.sql` recorded as applied and `public.memos` exists.
- Managed model revision `2`, active version ID, model name, and timeout are unchanged after startup.

These observations prove original service/dependency availability and configuration continuity. They alone do **not** prove an actual model request, streamed native rendering, or a tool run. Main subsequently submitted the authorized real native request below.

### Actual short request: persisted provider evidence

Main submitted an ordinary native request beginning `陪我休息一下吧` and reported seeing its reply. A read-only query located that exact request prefix in the currently saved native session; neither the credential nor session history was output. The following are actual existing rows written by the service, not fixtures:

| Evidence | Verified value |
| --- | --- |
| Run ID | `9aecfdc1-febf-4f9a-903c-157881adde8f` |
| Accepted time | 2026-09-29 14:08:09.709673 Asia/Shanghai |
| Run status | `completed` |
| Bound configuration | Existing version `1291fa94-d7b7-4d9a-87e9-659aa234a6a3` |
| Model calls | One, `gpt-5.6-luna`, `succeeded` |
| Provider interval | 14:08:10.801299–14:08:16.588905 Asia/Shanghai |
| Model duration | 5,787 ms |
| First visible text | 4,396 ms after model-call start |
| Usage source | `provider` |
| Usage | 6,524 input / 102 output / 6,626 total tokens |
| Persisted stream events | 72 `message.delta`, one each accepted/started/completed |
| Persisted message sizes | User 53 characters, assistant 84 characters |
| Tool calls | Zero |

This verifies a completed real request through the existing model provider with persisted streamed output. Native visual quality, send timing, rendering, and reopening remain main-session UI evidence; the database metrics do not substitute for that observation. This researcher made no model request independently.

### Actual long request: persisted provider evidence

Main then submitted the real native request beginning `请写一份约600字的轻量桌面整理指南`, observed partial text growing and a final formatted reply, and requested a second read-only metadata check:

| Evidence | Verified value |
| --- | --- |
| Run ID | `7ab80f0a-e905-40d3-8557-df99e261ef51` |
| Accepted time | 2026-09-29 14:09:21.976932 Asia/Shanghai |
| Run status | `completed` |
| Bound configuration | Existing version `1291fa94-d7b7-4d9a-87e9-659aa234a6a3` |
| Model calls | One, `gpt-5.6-luna`, `succeeded` |
| Provider interval | 14:09:23.030682–14:09:38.179148 Asia/Shanghai |
| Model duration | 15,148 ms |
| First visible text | 2,941 ms after model-call start |
| Usage source | `provider` |
| Usage | 6,674 input / 721 output / 7,395 total tokens |
| Persisted stream events | 655 `message.delta`, one each accepted/started/completed |
| Persisted message sizes | User 92 characters, assistant 982 characters |
| Tool calls | Zero |

The database completion time is 14:09:38; main inspected the final native state around 14:10. These are different observations, not a one-minute model duration. Both requests used the original configuration and real persistent conversation; no fixture response or seeded business record was used by this researcher. Main's reported formatting/streaming observations are not independently claimed as this researcher's visual inspection.

### Files found and code patterns

- `src-tauri/tauri.conf.json:5` — bundle identifier `ai.desktop.pet.juban`, used for the application configuration directory.
- `src-tauri/src/backend/mod.rs:333` — native `app_config_dir()/agent-config.json` path; configuration retains server and local modes. Local key serialization is disabled at `:40`; effective fallback fields resolve at `:64`.
- `src-tauri/src/backend/server.rs:19` — server backend startup; connection/retry paths consume the saved native server configuration.
- `server/README.md:15` — documented shared PostgreSQL, Redis 16380, and API 18081 boundary; `:21` gives the API startup entry point and `:24` separates configured state from successful inference.
- `server/compose.yaml:2` — pet compose owns only Redis, not the provider or PostgreSQL.
- `server/app/config.py:8` — `PET_AGENT_` settings and local `.env`; secrets use `repr=False`.
- `server/app/db.py:18` — startup migration execution under a transaction-scoped advisory lock; `:25` applies filenames in order.
- `server/migrations/009_memos.sql:1` — additive Memo storage with nullable real tool association; no sample records.
- `server/app/model_config.py:159` — active managed state resolution; `:197` is the separate secret-bearing version path, which this research did not query.
- `server/app/auth.py:21` — authentication hashes native bearer credentials and requires an active device and requested role; current validation only selected non-secret booleans/roles.
- `server/app/main.py:20` — startup invokes database/coordination/registry/service setup; `:65` reports effective model configuration for health.
- `server/app/agent_service.py:162` — normal worker/checkpoint startup; `:255` claims persisted queued runs. Availability is not a provider probe.

### Related specs

- `.trellis/spec/desktop/dual-mode-llm.md` — saved modes, native credential boundaries, single AgentView outlet, and manual real-endpoint acceptance.
- `.trellis/spec/backend/server-agent.md` — real persisted runs, device authentication, migration contract, and separate static/service/model/native evidence levels.
- Active task `prd.md`, `design.md`, and `implement.md` — use original real services/data and preserve existing contracts; no replacement/demo service.

### External references

No external web source was required. This question concerns the actual local installation and current repository. Python and uvicorn versions above were imported from the existing service environment. Historical September 14 provider-restoration notes guided which original endpoints to inspect; every current state stated here was independently verified on September 29.

## Caveats / Not Found

- No provider call, native UI operation, tool execution, or business record creation was performed by this researcher.
- No key was decrypted or printed; the presence of a key reference does not establish upstream validity.
- Main owns service lifecycle actions. Its original API log path is `/tmp/desktop-pet-live-20260929.log`; this researcher did not print raw service logs.
- Research role isolation forbids loading `implement.jsonl` or `check.jsonl`; no research manifest was present. Required PRD/design/implementation context and relevant specs were loaded directly.
- All process, port, health, and configuration findings are a snapshot for the current native acceptance run; do not treat them as future availability guarantees.
