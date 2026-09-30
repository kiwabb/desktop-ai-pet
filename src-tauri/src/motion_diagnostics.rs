//! Opt-in, debug-only local rendering contrast. No arbitrary script or business payloads.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Condvar, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Listener};

const REQUEST: &str = "/tmp/desktop-ai-pet-motion-request.json";
const RESULT: &str = "/tmp/desktop-ai-pet-motion-result.json";
const STATUS: &str = "/tmp/desktop-ai-pet-motion-status.json";
const PROTOCOL: &str = "phase-v5";
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Mode {
    Normal,
    NoShadows,
    TranslateOnly,
    None,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Action {
    None,
    Open,
    Todo,
    Back,
    Settings,
    Close,
}
#[derive(Clone, Serialize)]
struct Request {
    id: String,
    mode: Mode,
    action: Action,
    #[serde(
        rename = "armOnNextTransition",
        skip_serializing_if = "Option::is_none"
    )]
    arm_on_next_transition: Option<bool>,
}
impl<'de> Deserialize<'de> for Request {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Input {
            id: String,
            mode: Mode,
            action: Action,
            #[serde(default, rename = "armOnNextTransition", deserialize_with = "arm_flag")]
            arm_on_next_transition: Option<bool>,
        }
        fn arm_flag<'de, D: serde::Deserializer<'de>>(
            deserializer: D,
        ) -> Result<Option<bool>, D::Error> {
            bool::deserialize(deserializer).map(Some)
        }
        let input = Input::deserialize(deserializer)?;
        if input.arm_on_next_transition.is_some()
            && !(matches!(input.mode, Mode::Normal) && matches!(input.action, Action::None))
        {
            return Err(serde::de::Error::custom(
                "armOnNextTransition requires normal mode and none action",
            ));
        }
        Ok(Self {
            id: input.id,
            mode: input.mode,
            action: input.action,
            arm_on_next_transition: input.arm_on_next_transition,
        })
    }
}
impl Request {
    fn armed(&self) -> bool {
        self.arm_on_next_transition == Some(true)
    }
    // 30s arm + 1.5s capture + IPC/timer delivery allowance. Unarmed keeps 3s.
    fn report_timeout(&self) -> Duration {
        Duration::from_secs(if self.armed() { 35 } else { 3 })
    }
}
#[derive(Default)]
struct Control {
    ready: HashMap<String, serde_json::Value>,
    id: String,
    applied: HashMap<String, serde_json::Value>,
    reported: bool,
    target: String,
    routes: Vec<serde_json::Value>,
}

fn epoch() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
fn write_json(path: &str, mut value: serde_json::Value) {
    if !value.is_object() {
        return;
    }
    value["nativeReceivedEpoch"] = serde_json::json!(epoch());
    value["pid"] = serde_json::json!(std::process::id());
    let temporary = format!("{path}.tmp");
    if let Ok(bytes) = serde_json::to_vec(&value) {
        if let Err(error) =
            std::fs::write(&temporary, bytes).and_then(|_| std::fs::rename(&temporary, path))
        {
            eprintln!("motion diagnostic output {path}: {error}");
        }
    }
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn send_request(
    app: &AppHandle,
    label: &str,
    request: &Request,
    phase: &str,
) -> Result<(), String> {
    let mut value = serde_json::to_value(request).map_err(|e| e.to_string())?;
    value["phase"] = serde_json::json!(phase);
    value["targetLabel"] = serde_json::json!(label);
    app.emit_to(label, "pet:motion-diagnostic-command", value)
        .map_err(|e| e.to_string())
}
fn cancel_request(app: &AppHandle, request: &Request) {
    for label in ["main", "chat"] {
        let _ = send_request(app, label, request, "cancel");
    }
}
fn armed_request_interruption(request: &Request, bytes: Option<&[u8]>) -> Option<&'static str> {
    let Some(bytes) = bytes else {
        return Some("diagnostic-cancelled");
    };
    if bytes.len() > 4096 {
        return Some("invalid-replacement-request");
    }
    match serde_json::from_slice::<Request>(bytes) {
        Ok(next) if !valid_id(&next.id) => Some("invalid-replacement-request"),
        Ok(next) if next.id != request.id => Some("diagnostic-replaced"),
        Ok(_) => None,
        Err(_) => Some("invalid-replacement-request"),
    }
}
fn mode_acknowledged(control: &Control, request: &Request) -> bool {
    control.applied.len() == 2
        && control.applied.values().all(|value| {
            value.get("error").is_none()
                && value["mode"] == serde_json::to_value(&request.mode).unwrap()
        })
}

pub fn install(app: &AppHandle) {
    if std::env::var("PET_MOTION_DIAGNOSTICS").as_deref() != Ok("1") {
        return;
    }
    let shared = Arc::new((Mutex::new(Control::default()), Condvar::new()));
    for name in [
        "pet:motion-diagnostic-ready",
        "pet:motion-diagnostic-applied",
        "pet:motion-diagnostic-report",
        "pet:motion-diagnostic-route",
    ] {
        let shared = shared.clone();
        app.listen(name, move |event| {
            if event.payload().len() > 32768 {
                return;
            }
            let Ok(mut value) = serde_json::from_str::<serde_json::Value>(event.payload()) else {
                return;
            };
            let Some(label @ ("main" | "chat")) = value["window"].as_str() else {
                return;
            };
            let (lock, wake) = &*shared;
            let mut control = lock.lock().unwrap();
            if name == "pet:motion-diagnostic-ready" {
                control.ready.insert(label.to_owned(), value);
                write_json(
                    STATUS,
                    serde_json::json!({"phase":"frontend-ready", "windows":control.ready}),
                );
            } else if value["id"].as_str() == Some(control.id.as_str()) {
                if name == "pet:motion-diagnostic-applied" {
                    control.applied.insert(label.to_owned(), value);
                } else if name == "pet:motion-diagnostic-route" {
                    if control.routes.len() < 64 {
                        control.routes.push(value);
                    }
                    write_json(
                        "/tmp/desktop-ai-pet-motion-route.json",
                        serde_json::json!({"id":control.id,"routes":control.routes}),
                    );
                } else if label == control.target && !control.reported {
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
    let initial = std::fs::read(REQUEST)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Request>(&bytes).ok())
        .map(|r| r.id)
        .unwrap_or_default();
    write_json(
        RESULT,
        serde_json::json!({"status":"diagnostic-listening", "requestPath":REQUEST}),
    );
    write_json(
        STATUS,
        serde_json::json!({"phase":"listening", "expectedProtocol":PROTOCOL, "ignoredStartupId":initial}),
    );
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
                        write_json(
                            STATUS,
                            serde_json::json!({"phase":"request-read-failed", "error":error.to_string()}),
                        );
                    }
                    continue;
                }
            };
            if bytes == previous_bytes {
                continue;
            }
            previous_bytes = bytes.clone();
            write_json(
                STATUS,
                serde_json::json!({"phase":"request-read", "bytes":bytes.len()}),
            );
            if bytes.len() > 4096 {
                write_json(RESULT, serde_json::json!({"error":"request-too-large"}));
                continue;
            }
            let request = match serde_json::from_slice::<Request>(&bytes) {
                Ok(request) => request,
                Err(error) => {
                    write_json(
                        RESULT,
                        serde_json::json!({"error":"invalid-request-schema", "detail":error.to_string()}),
                    );
                    continue;
                }
            };
            if !valid_id(&request.id) {
                write_json(RESULT, serde_json::json!({"error":"invalid-request-id"}));
                continue;
            }
            if request.id == previous_id {
                continue;
            }
            previous_id = request.id.clone();
            let (lock, wake) = &*shared;
            {
                let mut control = lock.lock().unwrap();
                if control.ready.len() != 2 {
                    write_json(
                        RESULT,
                        serde_json::json!({"id":request.id,"error":"frontend-diagnostic-not-ready-use-motion-diagnostic-build", "ready":control.ready}),
                    );
                    continue;
                }
                if control
                    .ready
                    .values()
                    .any(|value| value["protocol"] != PROTOCOL)
                {
                    write_json(
                        RESULT,
                        serde_json::json!({"id":request.id,"error":"frontend-diagnostic-protocol-mismatch", "ready":control.ready}),
                    );
                    continue;
                }
                control.id = request.id.clone();
                control.applied.clear();
                control.reported = false;
                control.routes.clear();
                control.target = if matches!(request.action, Action::Open) {
                    "main"
                } else {
                    "chat"
                }
                .to_owned();
            }
            write_json(
                STATUS,
                serde_json::json!({"id":request.id,"phase":"applying-mode"}),
            );
            if ["main", "chat"]
                .iter()
                .any(|label| send_request(&app, label, &request, "apply").is_err())
            {
                lock.lock().unwrap().reported = true;
                write_json(
                    RESULT,
                    serde_json::json!({"id":request.id,"error":"mode-dispatch-failed"}),
                );
                cancel_request(&app, &request);
                continue;
            }
            let (mut control, _) = wake
                .wait_timeout_while(lock.lock().unwrap(), Duration::from_secs(2), |c| {
                    c.applied.len() != 2
                })
                .unwrap();
            if !mode_acknowledged(&control, &request) {
                control.reported = true;
                write_json(
                    RESULT,
                    serde_json::json!({"id":request.id,"error":"mode-ack-failed", "acks":control.applied}),
                );
                drop(control);
                cancel_request(&app, &request);
                continue;
            }
            drop(control);
            let target = if matches!(request.action, Action::Open) {
                "main"
            } else {
                "chat"
            };
            write_json(
                STATUS,
                serde_json::json!({"id":request.id,"phase":if request.armed() { "arming-transition" } else { "running-action" }, "window":target}),
            );
            if send_request(&app, target, &request, "run").is_err() {
                lock.lock().unwrap().reported = true;
                write_json(
                    RESULT,
                    serde_json::json!({"id":request.id,"error":"action-dispatch-failed"}),
                );
                cancel_request(&app, &request);
                continue;
            }
            let deadline = Instant::now() + request.report_timeout();
            loop {
                let (mut control, _) = wake
                    .wait_timeout_while(lock.lock().unwrap(), Duration::from_millis(250), |c| {
                        !c.reported
                    })
                    .unwrap();
                if control.reported {
                    break;
                }
                let error = if Instant::now() >= deadline {
                    Some("action-report-timeout")
                } else if request.armed() {
                    match std::fs::read(REQUEST) {
                        Ok(bytes) => armed_request_interruption(&request, Some(&bytes)),
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                            armed_request_interruption(&request, None)
                        }
                        Err(_) => Some("request-read-failed"),
                    }
                } else {
                    None
                };
                if let Some(error) = error {
                    // Fence late reports before cancelling the WebView's timer/RAF.
                    control.reported = true;
                    write_json(RESULT, serde_json::json!({"id":request.id,"error":error}));
                    drop(control);
                    cancel_request(&app, &request);
                    break;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_is_a_closed_schema_not_script_input() {
        let request: Request = serde_json::from_str(
            r#"{"id":"b5ceb776-ad0d-4d0a-a9a6-ead4b89a95ec","mode":"normal","action":"open"}"#,
        )
        .unwrap();
        assert!(valid_id(&request.id));
        assert!(
            serde_json::from_str::<Request>(r#"{"id":"run-1","mode":"eval","action":"todo"}"#)
                .is_err()
        );
        assert!(serde_json::from_str::<Request>(
            r#"{"id":"run-1","mode":"normal","action":"send"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<Request>(
            r#"{"id":"run-1","mode":"normal","action":"todo","script":"alert(1)"}"#
        )
        .is_err());
    }

    #[test]
    fn arm_flag_is_optional_boolean_for_passive_normal_only() {
        for flag in ["true", "false"] {
            let input = format!(
                r#"{{"id":"isolated-arm","mode":"normal","action":"none","armOnNextTransition":{flag}}}"#
            );
            let request: Request = serde_json::from_str(&input).unwrap();
            assert_eq!(request.armed(), flag == "true");
            assert_eq!(
                request.report_timeout(),
                Duration::from_secs(if flag == "true" { 35 } else { 3 })
            );
            for (mode, action) in [
                ("none", "none"),
                ("no-shadows", "none"),
                ("translate-only", "none"),
                ("normal", "open"),
                ("normal", "todo"),
            ] {
                let input = format!(
                    r#"{{"id":"isolated-arm","mode":"{mode}","action":"{action}","armOnNextTransition":{flag}}}"#
                );
                assert!(serde_json::from_str::<Request>(&input).is_err());
            }
        }
        for flag in ["null", "1", r#""true""#] {
            let input = format!(
                r#"{{"id":"isolated-arm","mode":"normal","action":"none","armOnNextTransition":{flag}}}"#
            );
            assert!(serde_json::from_str::<Request>(&input).is_err());
        }
        let request: Request =
            serde_json::from_str(r#"{"id":"isolated-old","mode":"normal","action":"none"}"#)
                .unwrap();
        assert!(!request.armed());
        assert_eq!(request.report_timeout(), Duration::from_secs(3));
        assert!(serde_json::to_value(request)
            .unwrap()
            .get("armOnNextTransition")
            .is_none());
    }

    #[test]
    fn armed_wait_distinguishes_same_request_replacement_and_cancel() {
        let bytes =
            br#"{"id":"isolated-arm","mode":"normal","action":"none","armOnNextTransition":true}"#;
        let request: Request = serde_json::from_slice(bytes).unwrap();
        assert!(request.report_timeout() > Duration::from_millis(30_000 + 1500));
        assert_eq!(armed_request_interruption(&request, Some(bytes)), None);
        assert_eq!(
            armed_request_interruption(&request, None),
            Some("diagnostic-cancelled")
        );
        assert_eq!(
            armed_request_interruption(
                &request,
                Some(br#"{"id":"next","mode":"normal","action":"none"}"#)
            ),
            Some("diagnostic-replaced")
        );
        assert_eq!(
            armed_request_interruption(
                &request,
                Some(br#"{"id":"next","mode":"normal","action":"send"}"#)
            ),
            Some("invalid-replacement-request")
        );
        assert_eq!(
            armed_request_interruption(
                &request,
                Some(br#"{"id":"../bad","mode":"normal","action":"none"}"#)
            ),
            Some("invalid-replacement-request")
        );
        assert_eq!(
            armed_request_interruption(&request, Some(b"partial")),
            Some("invalid-replacement-request")
        );
        assert_eq!(
            armed_request_interruption(&request, Some(&vec![b' '; 4097])),
            Some("invalid-replacement-request")
        );
    }

    #[test]
    fn arming_still_requires_both_windows_to_acknowledge_the_applied_mode() {
        let request: Request = serde_json::from_str(
            r#"{"id":"isolated-arm","mode":"normal","action":"none","armOnNextTransition":true}"#,
        )
        .unwrap();
        let mut control = Control::default();
        control
            .applied
            .insert("main".into(), serde_json::json!({"mode":"normal"}));
        assert!(!mode_acknowledged(&control, &request));
        control.applied.insert(
            "chat".into(),
            serde_json::json!({"mode":"normal","error":"busy"}),
        );
        assert!(!mode_acknowledged(&control, &request));
        control
            .applied
            .insert("chat".into(), serde_json::json!({"mode":"none"}));
        assert!(!mode_acknowledged(&control, &request));
        control
            .applied
            .insert("chat".into(), serde_json::json!({"mode":"normal"}));
        assert!(mode_acknowledged(&control, &request));
    }
}
