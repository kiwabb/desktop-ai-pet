# Legacy Tauri data inventory

Status: **read-only inventory; no user data was read, copied, rewritten, or
migrated by the Electron slice**.

The paths below are derived from the current product source. The actual base
directory must be resolved from the running Tauri app's `app_config_dir()` on the
target machine; this document does not hardcode a developer path or inspect
credentials.

## Durable files and ownership

| Relative path / store | Evidence | Owner | Migration state |
|---|---|---|---|
| `agent-local.db` | `src-tauri/src/backend/local.rs` | Local SQLite sessions, runs, messages, tool calls, todos, memos, events and context tables | Preserve as source; requires WAL-safe backup and fixture importer |
| `agent-config.json` | `src-tauri/src/backend/mod.rs` | Server/local mode and non-secret provider configuration | Preserve both mode sections; do not rewrite during Electron startup |
| `companion-preferences.json` | `src-tauri/src/companion_preferences.rs` | Pet scale and always-on-top preference only | Schema is small and independently testable; no importer yet |
| `pet-position.json` | `src-tauri/src/lib.rs` | Native pet position and geometry version | Electron uses its own user-data file; no live position migration yet |
| Customization metadata/files | `src-tauri/src/customization/` | User-created pet appearance, asset references and theme metadata | Preserve IDs/paths; credential-backed assets need a separate importer |
| Keychain `desktop-ai-pet` / `local-llm-api-key` | `src-tauri/src/backend/credentials.rs` | Local LLM credential | Host-side transfer only; never export or log the value |
| Keychain `desktop-ai-pet-images` / account id | `src-tauri/src/customization/provider.rs` | Private custom-pet image credentials | Discover account ids from metadata; transfer only through the OS credential store |

## Required migration order

1. Refuse concurrent legacy/new writers and record the source schema/version,
   row counts, WAL state, and asset inventory without logging secrets.
2. Create a recoverable SQLite backup that includes the relevant WAL state, then
   import into a separate Electron staging store.
3. Validate IDs, ordering, timestamps, foreign-key relationships, run states,
   todo/memo/reminder semantics, and custom asset references.
4. Write destination credentials through protected host APIs first. Scrub or
   remove a source credential only after the destination write succeeds; if the
   credential store is unavailable, retain the source and report a blocked item.
5. Commit a migration ledger and activate the destination atomically only after
   repeat-import and injected-failure tests pass. Keep the source backup intact.

## Explicit non-claims

- This inventory does not prove that Electron can resume a Pi-native session from
  a Tauri/Rust run. Engine session mapping remains a P3 design and test gate.
- The Electron `pet-position.json` file is not a migration of the Tauri position;
  its current implementation only restores positions already written by Electron.
- No keychain entry, database, config file, custom asset, or live user record was
  copied during this change.
