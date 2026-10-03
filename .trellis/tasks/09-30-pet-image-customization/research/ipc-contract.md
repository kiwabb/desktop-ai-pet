# Customization IPC contract (implementation boundary)

All commands are asynchronous. Tauri arguments are camelCase at top level; nested objects and all results use snake_case.
All mutations return `View`. Event `customization:changed` carries `View`. Consumers subscribe before initial read and reject older `revision`; async asset loads need the same revision fence. `warning` describes a notification failure after a committed mutation. Missing/corrupt stored files return an error, never an invented empty collection.

```ts
type Kind = 'base'|'closed'|'happy'|'talk'
type Asset = {width:number;height:number;anchor_x:number;anchor_y:number;connector_x?:number|null;connector_y?:number|null}
type Preset = {id:string;name:string;accent:string;created_at:string;assets:Record<Kind,Asset>}
type Job = {id:string;name:string;status:'running'|'failed'|'cancelled'|'interrupted'|'ready';stage:Kind|'saving';completed:Kind[];request_count:number;error:string|null}
type View = {revision:number;active_id:string;presets:Preset[];job:Job|null;settings:{base_url:string;model:string;has_key:boolean};warning:string|null}
```

- `customization_view()` -> View; defaults revision 0, active_id `default`, presets [], job null, settings empty strings/false, warning null.
- `customization_asset({id,kind})` -> `data:image/png;base64,...`. Kind also allows `reference-0`…`reference-3` for the current job only. IDs are UUIDs; only current job or saved preset readable. Assets fixed 768x960 normalized canvas; anchor_x=384, anchor_y=928 (foot). Use bottom-aligned contain. Default is rendered through existing built-in mask, not this API.
- `customization_save_settings({settings:{base_url,model,api_key,clear_key:boolean}})` -> View. Blank key retains same-endpoint credential; endpoint change never reuses it. No chat credentials. `base_url` is API root (e.g. https://provider/v1); implementation appends `/images/edits`. No automatic model discovery/paid probe.
- `customization_start({name,images:string[]})` -> View. Images are raw base64 without prefix, 1–4, each <=10MiB, total<=30MiB. Reference files copied/normalized before starting requests. Refuses an existing running job. Replaces prior terminal job, preserves all completed presets.
- `customization_retry({id,stage:Kind|null})` -> View. null resumes first incomplete stage. An explicit stage redoes only that state (base invalidates all derived states); cannot redo an active preset. Paid retries are explicit only. When redoing a completed preset, a new job ID is returned and the old complete preset is preserved.
- `customization_cancel({id})` -> View. Stops waiting, fences late output, preserves completed assets; no promise of provider refund.
- `customization_activate({id})` -> View; default accepts literal `default`. Frontend preloads/decodes all four assets first. Backend revalidates files then commits. Revision synchronizes all windows.
- `customization_update({id,name,accent})` -> View. Renames or changes theme seed; accent exactly #RRGGBB (lower/upper accepted), name trimmed 1–40 chars. Theme is deterministically derived frontend from seed. Updates active preset broadcast revision too.
- `customization_delete({id})` -> View. Only inactive saved presets; current running job protected. UI explicitly confirms the named target.

No API exposes filesystem paths, raw provider bodies, or credentials. No generated result automatically activates. Frame data uses validated PNG bytes. Persisted job documents survive restart as interrupted; startup never repeats a request.

Native attachment: `connector_x`/`connector_y` identify the alpha subject center X and upper-body 30% Y point on the normalized canvas; they do not claim an exact mouth. Native projection uses the same fixed CSS insets and own canvas dimensions, and publishes viewport-changed after appearance changes. Four completed assets with failed saving can retry finalization without any new provider request.
