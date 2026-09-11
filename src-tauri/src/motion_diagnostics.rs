//! Opt-in, debug-only local rendering contrast. No arbitrary script or business payloads.
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::{Arc, Condvar, Mutex}, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter, Listener};

const REQUEST: &str = "/tmp/desktop-ai-pet-motion-request.json";
const RESULT: &str = "/tmp/desktop-ai-pet-motion-result.json";
const STATUS: &str = "/tmp/desktop-ai-pet-motion-status.json";
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Mode { Normal, NoShadows, TranslateOnly, None }
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Action { None, Open, Todo, Back, Settings, Close }
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Request { id: String, mode: Mode, action: Action }
#[derive(Default)]
struct Control { ready: HashMap<String, serde_json::Value>, id: String, applied: HashMap<String, serde_json::Value>, reported: bool, target: String, routes: Vec<serde_json::Value> }

fn epoch() -> u128 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() }
fn write_json(path: &str, mut value: serde_json::Value) {
    if !value.is_object() { return; }
    value["nativeReceivedEpoch"] = serde_json::json!(epoch());
    value["pid"] = serde_json::json!(std::process::id());
    let temporary = format!("{path}.tmp");
    if let Ok(bytes) = serde_json::to_vec(&value) {
        if let Err(error) = std::fs::write(&temporary, bytes).and_then(|_| std::fs::rename(&temporary, path)) {
            eprintln!("motion diagnostic output {path}: {error}");
        }
    }
}
fn valid_id(id: &str) -> bool { !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') }
fn send_request(app: &AppHandle, label: &str, request: &Request, phase: &str) -> Result<(), String> {
    let mut value = serde_json::to_value(request).map_err(|e| e.to_string())?;
    value["phase"] = serde_json::json!(phase);
    value["targetLabel"] = serde_json::json!(label);
    app.emit_to(label, "pet:motion-diagnostic-command", value).map_err(|e| e.to_string())
}

pub fn install(app: &AppHandle) {
    if std::env::var("PET_MOTION_DIAGNOSTICS").as_deref() != Ok("1") { return; }
    let shared = Arc::new((Mutex::new(Control::default()), Condvar::new()));
    for name in ["pet:motion-diagnostic-ready", "pet:motion-diagnostic-applied", "pet:motion-diagnostic-report", "pet:motion-diagnostic-route"] {
        let shared = shared.clone();
        app.listen(name, move |event| {
            if event.payload().len() > 32768 { return; }
            let Ok(mut value) = serde_json::from_str::<serde_json::Value>(event.payload()) else { return; };
            let Some(label @ ("main" | "chat")) = value["window"].as_str() else { return; };
            let (lock, wake) = &*shared;
            let mut control = lock.lock().unwrap();
            if name == "pet:motion-diagnostic-ready" {
                control.ready.insert(label.to_owned(), value);
                write_json(STATUS, serde_json::json!({"phase":"frontend-ready", "windows":control.ready}));
            } else if value["id"].as_str() == Some(control.id.as_str()) {
                if name == "pet:motion-diagnostic-applied" { control.applied.insert(label.to_owned(), value); }
                else if name == "pet:motion-diagnostic-route" {
                    if control.routes.len() < 64 { control.routes.push(value); }
                    write_json("/tmp/desktop-ai-pet-motion-route.json", serde_json::json!({"id":control.id,"routes":control.routes}));
                } else if label == control.target {
                    control.reported = true;
                    value["route"] = serde_json::json!(control.routes);
                    write_json(RESULT, value);
                }
            }
            wake.notify_all();
        });
    }
    // Capture this synchronously before announcing listening: a caller writing
    // after the announcement must never be mistaken for a stale startup file.
    let initial = std::fs::read(REQUEST).ok().and_then(|bytes| serde_json::from_slice::<Request>(&bytes).ok()).map(|r| r.id).unwrap_or_default();
    write_json(RESULT, serde_json::json!({"status":"diagnostic-listening", "requestPath":REQUEST}));
    write_json(STATUS, serde_json::json!({"phase":"listening", "expectedProtocol":"phase-v4", "ignoredStartupId":initial}));
    let app = app.clone();
    std::thread::spawn(move || {
        let mut previous_id = initial;
        let mut previous_bytes = Vec::new();
        loop {
            std::thread::sleep(Duration::from_millis(250));
            let bytes = match std::fs::read(REQUEST) {
                Ok(bytes) => bytes,
                Err(error) => {
                    if error.kind() != std::io::ErrorKind::NotFound {
                        write_json(STATUS, serde_json::json!({"phase":"request-read-failed", "error":error.to_string()}));
                    }
                    continue;
                }
            };
            if bytes == previous_bytes { continue; }
            previous_bytes = bytes.clone();
            write_json(STATUS, serde_json::json!({"phase":"request-read", "bytes":bytes.len()}));
            if bytes.len() > 4096 { write_json(RESULT, serde_json::json!({"error":"request-too-large"})); continue; }
            let request = match serde_json::from_slice::<Request>(&bytes) {
                Ok(request) => request,
                Err(error) => { write_json(RESULT, serde_json::json!({"error":"invalid-request-schema", "detail":error.to_string()})); continue; }
            };
            if !valid_id(&request.id) { write_json(RESULT, serde_json::json!({"error":"invalid-request-id"})); continue; }
            if request.id == previous_id { continue; }
            previous_id = request.id.clone();
            let (lock, wake) = &*shared;
            {
                let mut control = lock.lock().unwrap();
                if control.ready.len() != 2 {
                    write_json(RESULT, serde_json::json!({"id":request.id,"error":"frontend-diagnostic-not-ready-use-motion-diagnostic-build", "ready":control.ready})); continue;
                }
                if control.ready.values().any(|value| value["protocol"] != "phase-v4") {
                    write_json(RESULT, serde_json::json!({"id":request.id,"error":"frontend-diagnostic-protocol-mismatch", "ready":control.ready})); continue;
                }
                control.id = request.id.clone(); control.applied.clear(); control.reported = false; control.routes.clear();
                control.target = if matches!(request.action, Action::Open) { "main" } else { "chat" }.to_owned();
            }
            write_json(STATUS, serde_json::json!({"id":request.id,"phase":"applying-mode"}));
            if ["main", "chat"].iter().any(|label| send_request(&app, label, &request, "apply").is_err()) {
                write_json(RESULT, serde_json::json!({"id":request.id,"error":"mode-dispatch-failed"})); continue;
            }
            let (control, _) = wake.wait_timeout_while(lock.lock().unwrap(), Duration::from_secs(2), |c| c.applied.len() != 2).unwrap();
            if control.applied.len() != 2 || control.applied.values().any(|value| value.get("error").is_some() || value["mode"] != serde_json::to_value(&request.mode).unwrap()) {
                write_json(RESULT, serde_json::json!({"id":request.id,"error":"mode-ack-failed", "acks":control.applied})); continue;
            }
            drop(control);
            let target = if matches!(request.action, Action::Open) { "main" } else { "chat" };
            write_json(STATUS, serde_json::json!({"id":request.id,"phase":"running-action", "window":target}));
            if send_request(&app, target, &request, "run").is_err() {
                write_json(RESULT, serde_json::json!({"id":request.id,"error":"action-dispatch-failed"})); continue;
            }
            let (control, _) = wake.wait_timeout_while(lock.lock().unwrap(), Duration::from_secs(3), |c| !c.reported).unwrap();
            if !control.reported { write_json(RESULT, serde_json::json!({"id":request.id,"error":"action-report-timeout"})); }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_is_a_closed_schema_not_script_input() {
        let request: Request = serde_json::from_str(r#"{"id":"b5ceb776-ad0d-4d0a-a9a6-ead4b89a95ec","mode":"normal","action":"open"}"#).unwrap();
        assert!(valid_id(&request.id));
        assert!(serde_json::from_str::<Request>(r#"{"id":"run-1","mode":"eval","action":"todo"}"#).is_err());
        assert!(serde_json::from_str::<Request>(r#"{"id":"run-1","mode":"normal","action":"send"}"#).is_err());
        assert!(serde_json::from_str::<Request>(r#"{"id":"run-1","mode":"normal","action":"todo","script":"alert(1)"}"#).is_err());
    }
}
