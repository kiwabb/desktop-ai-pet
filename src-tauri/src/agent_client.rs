use crate::agent_protocol::{Envelope, Snapshot};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, fs, io::Write, sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};

#[derive(Clone, Deserialize, Serialize)]
struct Config {
    base_url: String,
    token: String,
    session_id: Option<String>,
}
#[derive(Deserialize)]
pub struct Settings {
    pub base_url: String,
    pub token: String,
}
#[derive(Clone, Default, Serialize)]
pub struct View {
    generation: u64,
    revision: u64,
    configured: bool,
    endpoint: Option<String>,
    connection: String,
    node_connected: bool,
    node_error: Option<String>,
    model: Option<String>,
    model_configured: bool,
    error: Option<String>,
    snapshot: Snapshot,
    reminders: Vec<Todo>,
    reminder_error: Option<String>,
    todo_revision: u64,
}
#[derive(Default)]
struct Inner {
    config: Option<Config>,
    view: View,
    sender: Option<mpsc::Sender<Value>>,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
    initialized: bool,
    todo_mutation_epoch: u64,
    todo_writes_in_flight: u64,
    acknowledgements: HashMap<String, oneshot::Sender<Result<(), String>>>,
}
#[derive(Default)]
pub struct AgentState(Mutex<Inner>);
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoStatus {
    Pending,
    Completed,
}
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Todo {
    id: String,
    title: String,
    status: TodoStatus,
    created_at: String,
    remind_at: Option<String>,
}
#[derive(Deserialize)]
struct TodoResponse {
    items: Vec<Todo>,
}
#[derive(Serialize)]
pub struct TodoListView {
    generation: u64,
    items: Vec<Todo>,
}
#[derive(Deserialize)]
struct TodoCompletionResponse {
    item: Todo,
}
#[derive(Serialize)]
pub struct TodoCompletionView {
    generation: u64,
    item: Todo,
}

#[derive(Clone, Copy)]
enum TodoAction {
    Complete,
    Reopen,
}
impl TodoAction {
    fn path(self) -> &'static str {
        match self { Self::Complete => "complete", Self::Reopen => "reopen" }
    }
    fn label(self) -> &'static str {
        match self { Self::Complete => "完成", Self::Reopen => "取消完成" }
    }
    fn status(self) -> TodoStatus {
        match self { Self::Complete => TodoStatus::Completed, Self::Reopen => TodoStatus::Pending }
    }
}

async fn update_todo_http(config: &Config, todo_id: &str, action: TodoAction) -> Result<Todo, String> {
    let todo_id = uuid::Uuid::parse_str(todo_id)
        .map_err(|_| "待办标识不正确")?
        .to_string();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "无法初始化待办操作")?;
    let response = client
        .post(format!("{}/v1/todos/{}/{}", config.base_url, todo_id, action.path()))
        .bearer_auth(&config.token)
        .send()
        .await
        .map_err(|_| format!("尚未确认{}结果，请刷新核对或重试", action.label()))?;
    if !response.status().is_success() {
        return Err(format!(
            "{}待办失败（{}），请刷新核对或重试",
            action.label(), response.status().as_u16()
        ));
    }
    let response: TodoCompletionResponse = response
        .json()
        .await
        .map_err(|_| format!("{}结果格式不正确，请刷新核对", action.label()))?;
    if response.item.id != todo_id || response.item.status != action.status() {
        return Err(format!("{}结果与请求不一致，请刷新核对", action.label()));
    }
    Ok(response.item)
}

#[tauri::command]
pub async fn agent_complete_todo(
    app: AppHandle,
    todo_id: String,
) -> Result<TodoCompletionView, String> {
    update_todo(app, todo_id, TodoAction::Complete).await
}

#[tauri::command]
pub async fn agent_reopen_todo(app: AppHandle, todo_id: String) -> Result<TodoCompletionView, String> {
    update_todo(app, todo_id, TodoAction::Reopen).await
}

async fn update_todo(app: AppHandle, todo_id: String, action: TodoAction) -> Result<TodoCompletionView, String> {
    let (config, generation) = begin_todo_write(&app)?;
    let result = update_todo_http(&config, &todo_id, action).await;
    finish_todo_write(&app, generation, result)
}

fn begin_todo_write(app: &AppHandle) -> Result<(Config, u64), String> {
    let state = app.state::<AgentState>();
    let mut inner = state.0.lock().unwrap();
    let config = todo_config(&inner)?;
    inner.todo_mutation_epoch += 1;
    inner.todo_writes_in_flight += 1;
    Ok(config)
}

fn apply_todo_write(inner: &mut Inner, generation: u64, result: Result<Todo, String>) -> Result<TodoCompletionView, String> {
    if inner.view.generation != generation {
        return Err("助手配置已更换，请重新查询待办".into());
    }
    inner.todo_mutation_epoch += 1;
    inner.todo_writes_in_flight -= 1;
    let item = result?;
    inner.view.reminders.retain(|todo| todo.id != item.id);
    inner.view.todo_revision += 1;
    Ok(TodoCompletionView { generation, item })
}

fn finish_todo_write(app: &AppHandle, generation: u64, result: Result<Todo, String>) -> Result<TodoCompletionView, String> {
    let state = app.state::<AgentState>();
    let mut inner = state.0.lock().unwrap();
    let result = apply_todo_write(&mut inner, generation, result);
    if result.is_ok() {
        inner.view.revision += 1;
        let _ = app.emit("agent:view", &inner.view);
    }
    result
}

async fn set_reminder_http(config: &Config, todo_id: &str, remind_at: Option<&str>, expected_remind_at: Option<&str>) -> Result<Todo, String> {
    let todo_id = uuid::Uuid::parse_str(todo_id).map_err(|_| "待办标识不正确")?.to_string();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build().map_err(|_| "无法初始化提醒操作")?;
    let response = client.put(format!("{}/v1/todos/{}/reminder", config.base_url, todo_id))
        .bearer_auth(&config.token)
        .json(&json!({"remind_at": remind_at, "expected_remind_at": expected_remind_at}))
        .send().await.map_err(|_| "尚未确认提醒保存结果，请刷新核对或重试")?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            400 => "提醒时间无效或已经过去，请重新设置".into(),
            409 => "待办或提醒已被修改，请刷新后重试".into(),
            code => format!("保存提醒失败（{}），请刷新核对或重试", code),
        });
    }
    let response: TodoCompletionResponse = response.json().await.map_err(|_| "提醒结果格式不正确，请刷新核对")?;
    if response.item.id != todo_id || response.item.status != TodoStatus::Pending
        || response.item.remind_at.is_some() != remind_at.is_some() {
        return Err("提醒结果与请求不一致，请刷新核对".into());
    }
    Ok(response.item)
}

#[tauri::command]
pub async fn agent_set_todo_reminder(app: AppHandle, todo_id: String, remind_at: Option<String>, expected_remind_at: Option<String>) -> Result<TodoCompletionView, String> {
    let (config, generation) = begin_todo_write(&app)?;
    let result = set_reminder_http(&config, &todo_id, remind_at.as_deref(), expected_remind_at.as_deref()).await;
    finish_todo_write(&app, generation, result)
}

fn todo_config(inner: &Inner) -> Result<(Config, u64), String> {
    Ok((
        inner.config.clone().ok_or("请先配置助手服务")?,
        inner.view.generation,
    ))
}

async fn fetch_todos(config: &Config) -> Result<Vec<Todo>, String> {
    fetch_todo_collection(config, false).await
}

async fn fetch_todo_collection(config: &Config, due_only: bool) -> Result<Vec<Todo>, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "无法初始化待办查询")?;
    let response = client
        .get(format!("{}/v1/todos{}", config.base_url, if due_only { "/reminders/due" } else { "" }))
        .bearer_auth(&config.token)
        .send()
        .await
        .map_err(|_| "无法查询待办，请检查助手服务并重试")?;
    if !response.status().is_success() {
        return Err(format!(
            "待办查询失败（{}），请检查服务和设备凭证",
            response.status().as_u16()
        ));
    }
    let response: TodoResponse = response.json().await.map_err(|_| "待办列表格式不正确")?;
    if due_only && response.items.iter().any(|todo| todo.status != TodoStatus::Pending || todo.remind_at.as_ref().is_none_or(|time| time.is_empty())) {
        return Err("提醒列表格式不正确".into());
    }
    Ok(response.items)
}

fn apply_reminder_poll(inner: &mut Inner, generation: u64, epoch: u64, result: Result<Vec<Todo>, String>) -> bool {
    if inner.view.generation != generation || inner.todo_mutation_epoch != epoch || inner.todo_writes_in_flight > 0 {
        return false;
    }
    match result {
        Ok(items) => {
            let changed = inner.view.reminders != items || inner.view.reminder_error.is_some();
            inner.view.reminders = items;
            inner.view.reminder_error = None;
            changed
        }
        Err(error) => {
            let changed = inner.view.reminder_error.as_ref() != Some(&error);
            inner.view.reminder_error = Some(error);
            changed
        }
    }
}

async fn poll_reminders(app: &AppHandle, generation: u64, config: &Config) {
    loop {
        let epoch = {
            let state = app.state::<AgentState>();
            let inner = state.0.lock().unwrap();
            if inner.view.generation != generation { return; }
            inner.todo_mutation_epoch
        };
        let result = fetch_todo_collection(config, true).await;
        {
            let state = app.state::<AgentState>();
            let mut inner = state.0.lock().unwrap();
            if apply_reminder_poll(&mut inner, generation, epoch, result) {
                inner.view.revision += 1;
                let _ = app.emit("agent:view", &inner.view);
            }
        }
        tokio::time::sleep(Duration::from_secs(15)).await;
    }
}

#[tauri::command]
pub async fn agent_list_todos(app: AppHandle) -> Result<TodoListView, String> {
    let (config, generation) = {
        let state = app.state::<AgentState>();
        let inner = state.0.lock().unwrap();
        todo_config(&inner)?
    };
    let items = fetch_todos(&config).await?;
    let state = app.state::<AgentState>();
    let inner = state.0.lock().unwrap();
    if inner.view.generation != generation {
        return Err("助手配置已更换，请重新查询待办".into());
    }
    Ok(TodoListView { generation, items })
}
fn normalized_url(raw: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| "请输入有效的助手服务地址")?;
    let local = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if (url.scheme() != "https" && !(url.scheme() == "http" && local))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "远程服务必须使用 HTTPS；仅本机回环地址允许 HTTP，地址不能包含凭证或查询参数".into(),
        );
    }
    Ok(url.as_str().trim_end_matches('/').into())
}
fn path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| "无法访问助手配置目录")?
        .join("agent-config.json"))
}
fn persist(app: &AppHandle, config: &Config) -> Result<(), String> {
    let path = path(app)?;
    fs::create_dir_all(path.parent().ok_or("配置目录不存在")?)
        .map_err(|_| "无法创建助手配置目录")?;
    let temp = path.with_extension("tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp).map_err(|_| "无法保存助手配置")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| "无法保护设备凭证")?;
    }
    file.write_all(&serde_json::to_vec(config).map_err(|_| "配置编码失败")?)
        .map_err(|_| "配置写入失败")?;
    file.sync_all().map_err(|_| "配置写入失败")?;
    fs::rename(temp, path).map_err(|_| "配置保存失败".into())
}
fn change(app: &AppHandle, generation: u64, f: impl FnOnce(&mut Inner)) {
    let state = app.state::<AgentState>();
    let mut inner = state.0.lock().unwrap();
    if inner.view.generation != generation {
        return;
    }
    f(&mut inner);
    inner.view.revision += 1;
    let _ = app.emit("agent:view", &inner.view);
}
fn start(app: &AppHandle, inner: &mut Inner, config: Config) {
    if let Some(task) = inner.task.take() {
        task.abort();
    }
    let generation = inner.view.generation + 1;
    inner.view = View {
        generation,
        configured: true,
        endpoint: Some(config.base_url.clone()),
        connection: "connecting".into(),
        ..Default::default()
    };
    inner.config = Some(config.clone());
    inner.sender = None;
    inner.todo_mutation_epoch = 0;
    inner.todo_writes_in_flight = 0;
    inner.acknowledgements.clear();
    let handle = app.clone();
    inner.task = Some(tauri::async_runtime::spawn(async move {
        // Role connections and reminder reads retry independently. Aborting this
        // settings generation drops all sockets, HTTP reads and retry timers.
        tokio::join!(
            reconnect_control(&handle, generation, &config),
            reconnect_node(&handle, generation, &config),
            poll_reminders(&handle, generation, &config),
        );
    }));
}
async fn reconnect_control(app: &AppHandle, generation: u64, config: &Config) {
    let mut delay = 1;
    loop {
        change(app, generation, |i| i.view.connection = "connecting".into());
        let result = control(app, generation, config).await;
        change(app, generation, |i| {
            i.sender = None;
            i.view.connection = "disconnected".into();
            i.view.error = Some(
                result
                    .err()
                    .unwrap_or_else(|| "聊天连接已断开，正在重连".into()),
            );
        });
        tokio::time::sleep(Duration::from_secs(delay)).await;
        delay = (delay * 2).min(15);
    }
}
fn mark_node_disconnected(inner: &mut Inner, error: String) {
    inner.view.node_connected = false;
    inner.view.node_error = Some(error);
}
async fn reconnect_node(app: &AppHandle, generation: u64, config: &Config) {
    let mut delay = 1;
    loop {
        let result = node(app, generation, config).await;
        change(app, generation, |i| {
            mark_node_disconnected(
                i,
                result
                    .err()
                    .unwrap_or_else(|| "设备连接已断开，正在重连".into()),
            )
        });
        tokio::time::sleep(Duration::from_secs(delay)).await;
        delay = (delay * 2).min(15);
    }
}

#[tauri::command]
pub fn agent_view(app: AppHandle) -> View {
    let state = app.state::<AgentState>();
    let mut inner = state.0.lock().unwrap();
    if !inner.initialized {
        inner.initialized = true;
        let config = path(&app)
            .ok()
            .and_then(|p| fs::read(p).ok())
            .and_then(|b| serde_json::from_slice::<Config>(&b).ok());
        if let Some(config) =
            config.filter(|c| normalized_url(&c.base_url).is_ok() && !c.token.is_empty())
        {
            start(&app, &mut inner, config);
        } else {
            inner.view.connection = "unconfigured".into();
        }
    }
    inner.view.clone()
}
#[tauri::command]
pub fn save_agent_settings(app: AppHandle, settings: Settings) -> Result<View, String> {
    let base_url = normalized_url(&settings.base_url)?;
    let state = app.state::<AgentState>();
    let mut inner = state.0.lock().unwrap();
    let same = inner.config.as_ref().filter(|c| c.base_url == base_url);
    let token = if settings.token.trim().is_empty() {
        same.map(|c| c.token.clone())
            .ok_or("更换地址必须重新输入该服务的设备凭证")?
    } else {
        settings.token.trim().to_owned()
    };
    if token.chars().any(char::is_control) {
        return Err("设备凭证格式不正确".into());
    }
    let session_id = same
        .filter(|c| c.token == token)
        .and_then(|c| c.session_id.clone());
    let config = Config {
        base_url,
        token,
        session_id,
    };
    persist(&app, &config)?;
    inner.initialized = true;
    start(&app, &mut inner, config);
    let _ = app.emit("agent:view", &inner.view);
    Ok(inner.view.clone())
}
#[tauri::command]
pub async fn agent_submit(app: AppHandle, request_id: String, text: String) -> Result<(), String> {
    if text.trim().is_empty() || text.len() > 32000 || uuid::Uuid::parse_str(&request_id).is_err() {
        return Err("消息或请求标识不正确".into());
    }
    let (ack_tx, ack_rx) = oneshot::channel();
    let (sender, session_id, generation) = {
        let state = app.state::<AgentState>();
        let mut inner = state.0.lock().unwrap();
        if inner.view.connection != "connected" || !inner.view.model_configured {
            return Err("助手未连接或服务端模型尚未配置".into());
        }
        let sender = inner.sender.clone().ok_or("助手连接已断开")?;
        inner.acknowledgements.insert(request_id.clone(), ack_tx);
        (
            sender,
            inner.view.snapshot.session_id.clone(),
            inner.view.generation,
        )
    };
    let sent = sender.send(json!({"v":1,"type":"run.submit","request_id":request_id,"session_id":session_id,"payload":{"text":text}})).await;
    let result = if sent.is_err() {
        Err("助手连接已断开，消息尚未发送".into())
    } else {
        match tokio::time::timeout(Duration::from_secs(12), ack_rx).await {
            Ok(Ok(result)) => result,
            _ => Err("尚未确认消息是否已接收；请重连核对，重试同一内容不会重复提交".into()),
        }
    };
    let state = app.state::<AgentState>();
    let mut inner = state.0.lock().unwrap();
    if inner.view.generation == generation {
        inner.acknowledgements.remove(&request_id);
    }
    result
}
async fn socket(
    config: &Config,
    role: &str,
) -> Result<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    String,
> {
    let url = format!(
        "{}/v1/{}/ws",
        config
            .base_url
            .replacen("https://", "wss://", 1)
            .replacen("http://", "ws://", 1),
        role
    );
    let mut request = url.into_client_request().map_err(|_| "助手连接地址无效")?;
    request.headers_mut().insert(
        "Authorization",
        format!("Bearer {}", config.token)
            .parse()
            .map_err(|_| "设备凭证格式不正确")?,
    );
    // connect_async does not follow redirects; credentials stay at the configured origin.
    tokio::time::timeout(Duration::from_secs(15), connect_async(request))
        .await
        .map_err(|_| "连接助手超时")?
        .map(|(s, _)| s)
        .map_err(|_| "无法连接助手：请检查地址、设备凭证及角色授权".into())
}
async fn control(app: &AppHandle, generation: u64, config: &Config) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "无法初始化连接")?;
    let response = client
        .get(format!("{}/v1/status", config.base_url))
        .bearer_auth(&config.token)
        .send()
        .await
        .map_err(|_| "无法访问助手服务")?;
    if !response.status().is_success() {
        return Err(format!(
            "助手认证或状态检查失败（{}）",
            response.status().as_u16()
        ));
    }
    #[derive(Deserialize)]
    struct Status {
        model: Option<String>,
        model_configured: bool,
    }
    let status: Status = response.json().await.map_err(|_| "助手状态格式不正确")?;
    change(app, generation, |i| {
        i.view.model = status.model;
        i.view.model_configured = status.model_configured;
    });
    let mut ws = socket(config, "control").await?;
    let session = {
        let state = app.state::<AgentState>();
        let inner = state.0.lock().unwrap();
        inner.config.as_ref().and_then(|c| c.session_id.clone())
    };
    ws.send(Message::Text(
        json!({"v":1,"type":"session.open","payload":{"session_id":session}})
            .to_string()
            .into(),
    ))
    .await
    .map_err(|_| "无法恢复会话")?;
    let (tx, mut rx) = mpsc::channel::<Value>(8);
    let mut last_received = tokio::time::Instant::now();
    let mut tick = tokio::time::interval(Duration::from_secs(20));
    loop {
        tokio::select! {
            outbound = rx.recv() => {
                if let Some(outbound) = outbound { ws.send(Message::Text(outbound.to_string().into())).await.map_err(|_| "消息发送中断，请重连后核对是否已接收")?; }
            }
            _ = tick.tick() => {
                if last_received.elapsed() > Duration::from_secs(65) { return Err("助手连接超时，正在重连".into()); }
                ws.send(Message::Ping(Vec::new().into())).await.map_err(|_| "助手连接已断开")?;
            }
            incoming = ws.next() => {
                let incoming = incoming.ok_or("助手连接已断开")?.map_err(|_| "助手连接中断")?;
                last_received = tokio::time::Instant::now();
                if let Message::Text(text) = incoming {
                    let event: Envelope = serde_json::from_str(&text).map_err(|_| "服务端协议格式不正确")?;
                    if event.v != 1 { return Err("服务端协议版本不兼容".into()); }
                    if event.kind == "protocol.error" {
                        let message = event.payload["message"].as_str().unwrap_or("助手拒绝了请求").to_owned();
                        change(app, generation, |i| {
                            if let Some(id) = &event.request_id {
                                if let Some(tx) = i.acknowledgements.remove(id) { let _ = tx.send(Err(message.clone())); }
                            }
                            i.view.error = Some(message.clone());
                        });
                        if event.request_id.is_none() { return Err(message); }
                        continue;
                    }
                    let mut applied = Ok(());
                    change(app, generation, |i| {
                        match i.view.snapshot.apply(&event) {
                            Err(error) => applied = Err(error),
                            Ok(changed) => {
                                for run in &i.view.snapshot.runs {
                                    if let Some(tx) = i.acknowledgements.remove(&run.request_id) { let _ = tx.send(Ok(())); }
                                }
                                if changed && event.kind == "session.snapshot" {
                                    if let Some(config) = &mut i.config {
                                        config.session_id = Some(i.view.snapshot.session_id.clone());
                                        if let Err(error) = persist(app, config) { applied = Err(error); return; }
                                    }
                                    i.sender = Some(tx.clone()); i.view.connection = "connected".into(); i.view.error = None;
                                }
                            }
                        }
                    });
                    applied?;
                } else if matches!(incoming, Message::Close(_)) { return Err("助手关闭了连接，正在重连".into()); }
            }
        }
    }
}
async fn node(app: &AppHandle, generation: u64, config: &Config) -> Result<(), String> {
    let mut ws = socket(config, "node").await?;
    ws.send(Message::Text(
        json!({"v":1,"type":"node.register","payload":{"capabilities":[]}})
            .to_string()
            .into(),
    ))
    .await
    .map_err(|_| "设备登记失败")?;
    let mut connection_id: Option<String> = None;
    let mut heartbeat = tokio::time::interval(Duration::from_secs(15));
    let mut last_received = tokio::time::Instant::now();
    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                if last_received.elapsed() > Duration::from_secs(45) { return Err("设备心跳超时".into()); }
                if let Some(id) = &connection_id { ws.send(Message::Text(json!({"v":1,"type":"node.heartbeat","payload":{"connection_id":id}}).to_string().into())).await.map_err(|_| "设备心跳中断")?; }
            }
            message = ws.next() => {
                let message = message.ok_or("设备连接已断开")?.map_err(|_| "设备连接中断")?;
                if let Message::Text(text) = message {
                    let event: Envelope = serde_json::from_str(&text).map_err(|_| "设备协议格式不正确")?;
                    if event.v != 1 { return Err("设备协议版本不兼容".into()); }
                    if event.kind == "node.registered" {
                        connection_id = Some(event.payload["connection_id"].as_str().ok_or("设备登记缺少连接标识")?.into());
                        last_received = tokio::time::Instant::now();
                        change(app, generation, |i| { i.view.node_connected = true; i.view.node_error = None; });
                    } else if event.kind == "node.heartbeat_ack" { last_received = tokio::time::Instant::now(); }
                    else if event.kind == "protocol.error" { return Err(event.payload["message"].as_str().unwrap_or("设备登记被拒绝").into()); }
                    else { return Err("服务端发送了尚不支持的设备操作".into()); }
                } else if matches!(message, Message::Close(_)) { return Err("设备连接已关闭".into()); }
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn todo_query_does_not_require_model_or_websockets() {
        let mut inner = Inner::default();
        assert!(todo_config(&inner).is_err());
        inner.config = Some(Config {
            base_url: "http://127.0.0.1:1".into(),
            token: "unit-only".into(),
            session_id: None,
        });
        inner.view.generation = 7;
        let (_, generation) = todo_config(&inner).unwrap();
        assert_eq!(generation, 7);
        assert!(!inner.view.model_configured);
        assert!(!inner.view.node_connected);
        assert!(inner.sender.is_none());
    }

    // Isolated HTTP boundary doubles; no real service, model or business data.
    async fn todo_http_fixture(status: &str, body: &str) -> Result<Vec<Todo>, String> {
        todo_boundary_fixture(status, body, None).await
    }
    async fn todo_boundary_fixture(
        status: &str,
        body: &str,
        action: Option<TodoAction>,
    ) -> Result<Vec<Todo>, String> {
        use std::io::Read;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let response = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nLocation: http://127.0.0.1:1/secret\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = [0u8; 4096];
            let size = socket.read(&mut bytes).unwrap();
            let request = String::from_utf8_lossy(&bytes[..size]).to_lowercase();
            let expected = match action {
                Some(action) => format!("post /v1/todos/00000000-0000-0000-0000-000000000001/{} ", action.path()),
                None => "get /v1/todos ".into(),
            };
            assert!(request.starts_with(&expected));
            assert!(request.contains("authorization: bearer unit-only"));
            socket.write_all(response.as_bytes()).unwrap();
        });
        let config = Config {
            base_url: format!("http://{address}"),
            token: "unit-only".into(),
            session_id: None,
        };
        let result = if let Some(action) = action {
            update_todo_http(&config, "00000000-0000-0000-0000-000000000001", action)
                .await
                .map(|item| vec![item])
        } else {
            fetch_todos(&config).await
        };
        server.join().unwrap();
        result
    }

    #[tokio::test]
    async fn todo_http_distinguishes_empty_errors_and_invalid_status() {
        assert!(todo_http_fixture("200 OK", "{\"items\":[]}")
            .await
            .unwrap()
            .is_empty());
        assert!(todo_http_fixture("401 Unauthorized", "secret body")
            .await
            .unwrap_err()
            .contains("401"));
        assert!(todo_http_fixture("302 Found", "")
            .await
            .unwrap_err()
            .contains("302"));
        assert!(todo_http_fixture("200 OK", r#"{"items":[{"id":"unit-only","title":"isolated","status":"unknown","created_at":"2026-09-07T00:00:00Z"}]}"#).await.is_err());
        let items = todo_http_fixture("200 OK", r#"{"items":[{"id":"unit-only","title":"isolated","status":"completed","created_at":"2026-09-07T00:00:00Z"}]}"#).await.unwrap();
        assert!(matches!(items[0].status, TodoStatus::Completed));
    }
    #[tokio::test]
    async fn todo_writes_check_method_auth_status_identity_and_safe_paths() {
        for action in [TodoAction::Complete, TodoAction::Reopen] {
            let target = match action { TodoAction::Complete => "completed", TodoAction::Reopen => "pending" };
            let wrong = match action { TodoAction::Complete => "pending", TodoAction::Reopen => "completed" };
            let body = format!(r#"{{"item":{{"id":"00000000-0000-0000-0000-000000000001","title":"isolated","status":"{target}","created_at":"2026-09-07T00:00:00Z"}}}}"#);
            assert_eq!(todo_boundary_fixture("200 OK", &body, Some(action)).await.unwrap()[0].status, action.status());
            for invalid in [body.replace(target, wrong), body.replace("000000000001", "000000000002"), "invalid JSON".into()] {
                assert!(todo_boundary_fixture("200 OK", &invalid, Some(action)).await.is_err());
            }
            for code in ["403 Forbidden", "404 Not Found", "302 Found", "503 Unavailable"] {
                let error = todo_boundary_fixture(code, "private server detail", Some(action)).await.unwrap_err();
                assert!(error.contains(&code[..3]));
                assert!(error.contains(action.label()));
                assert!(!error.contains("private"));
            }
            let config = Config { base_url: "http://127.0.0.1:1".into(), token: "unit-only".into(), session_id: None };
            assert_eq!(update_todo_http(&config, "../invalid", action).await.unwrap_err(), "待办标识不正确");
            let error = update_todo_http(&config, "00000000-0000-0000-0000-000000000001", action).await.unwrap_err();
            assert!(error.contains("尚未确认"));
            assert!(error.contains(action.label()));
        }
    }
    fn isolated_reminder() -> Todo {
        Todo { id: "00000000-0000-0000-0000-000000000001".into(), title: "isolated".into(),
            status: TodoStatus::Pending, created_at: "2026-09-07T00:00:00Z".into(),
            remind_at: Some("2026-09-07T08:00:00Z".into()) }
    }

    #[test]
    fn reminder_poll_preserves_failed_data_and_rejects_mutation_or_generation_races() {
        let mut inner = Inner::default();
        inner.view.generation = 4;
        let due = vec![isolated_reminder()];
        assert!(apply_reminder_poll(&mut inner, 4, 0, Ok(due.clone())));
        assert!(!apply_reminder_poll(&mut inner, 4, 0, Ok(due.clone())));
        assert!(apply_reminder_poll(&mut inner, 4, 0, Err("offline".into())));
        assert_eq!(inner.view.reminders, due);
        assert!(!apply_reminder_poll(&mut inner, 3, 0, Ok(vec![])));
        assert_eq!(inner.view.reminders, due);
        inner.todo_mutation_epoch = 1;
        inner.todo_writes_in_flight = 1;
        assert!(!apply_reminder_poll(&mut inner, 4, 0, Ok(vec![])));
        assert!(!apply_reminder_poll(&mut inner, 4, 1, Ok(vec![])));
        let mut completed = isolated_reminder();
        completed.status = TodoStatus::Completed;
        completed.remind_at = None;
        apply_todo_write(&mut inner, 4, Ok(completed)).unwrap();
        assert!(inner.view.reminders.is_empty());
        assert_eq!(inner.view.todo_revision, 1);
        assert_eq!(inner.todo_writes_in_flight, 0);
        assert!(!apply_reminder_poll(&mut inner, 4, 1, Ok(due.clone())));
        assert!(apply_reminder_poll(&mut inner, 4, 2, Ok(vec![]))); // clears error
        inner.view.reminders = due.clone();
        inner.todo_writes_in_flight = 1;
        assert!(apply_todo_write(&mut inner, 4, Err("uncertain".into())).is_err());
        assert_eq!(inner.view.reminders, due);
        assert_eq!(inner.todo_writes_in_flight, 0);
        assert_eq!(inner.view.todo_revision, 1);
        let epoch = inner.todo_mutation_epoch;
        assert!(apply_todo_write(&mut inner, 3, Ok(isolated_reminder())).is_err());
        assert_eq!(inner.todo_mutation_epoch, epoch);
    }

    // Local test socket only: validates exact auth/method/body and typed responses.
    async fn reminder_boundary_fixture(status: &str, body: &str, write: bool, target: Option<&str>) -> Result<Vec<Todo>, String> {
        use std::io::Read;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let expected_body = json!({"remind_at": target, "expected_remind_at": null});
        let response = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nLocation: http://127.0.0.1:1/secret\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut request = Vec::new();
            loop {
                let mut buffer = [0; 4096];
                let size = socket.read(&mut buffer).unwrap();
                assert!(size > 0);
                request.extend_from_slice(&buffer[..size]);
                if let Some(boundary) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..boundary]).to_lowercase();
                    let length = headers.lines().find_map(|line| line.strip_prefix("content-length: ")).map(|text| text.parse::<usize>().unwrap()).unwrap_or(0);
                    if request.len() < boundary + 4 + length { continue; }
                    let path = if write { "put /v1/todos/00000000-0000-0000-0000-000000000001/reminder " } else { "get /v1/todos/reminders/due " };
                    assert!(headers.starts_with(path));
                    assert!(headers.contains("authorization: bearer unit-only"));
                    if write { assert_eq!(serde_json::from_slice::<Value>(&request[boundary+4..boundary+4+length]).unwrap(), expected_body); }
                    break;
                }
            }
            socket.write_all(response.as_bytes()).unwrap();
        });
        let config = Config { base_url: format!("http://{address}"), token: "unit-only".into(), session_id: None };
        let result = if write {
            set_reminder_http(&config, "00000000-0000-0000-0000-000000000001", target, None).await.map(|item| vec![item])
        } else { fetch_todo_collection(&config, true).await };
        server.join().unwrap();
        result
    }

    #[tokio::test]
    async fn reminder_reads_validate_due_shape_auth_redirects_and_errors() {
        let item = isolated_reminder();
        let body = json!({"items": [&item]}).to_string();
        assert_eq!(reminder_boundary_fixture("200 OK", &body, false, None).await.unwrap(), vec![item.clone()]);
        assert!(reminder_boundary_fixture("200 OK", r#"{"items":[]}"#, false, None).await.unwrap().is_empty());
        for invalid in [body.replace("pending", "completed"), body.replace("2026-09-07T08:00:00Z", ""), r#"{"items":[{"id":"bad"}]}"#.into(), "invalid".into()] {
            assert!(reminder_boundary_fixture("200 OK", &invalid, false, None).await.is_err());
        }
        for status in ["403 Forbidden", "302 Found", "503 Unavailable"] {
            let error = reminder_boundary_fixture(status, "secret upstream body", false, None).await.unwrap_err();
            assert!(error.contains(&status[..3]));
            assert!(!error.contains("secret"));
        }
    }

    #[tokio::test]
    async fn reminder_writes_validate_explicit_body_identity_status_and_nullability() {
        let item = isolated_reminder();
        let body = json!({"item": &item}).to_string();
        let target = item.remind_at.as_deref();
        assert_eq!(reminder_boundary_fixture("200 OK", &body, true, target).await.unwrap(), vec![item.clone()]);
        for invalid in [body.replace("pending", "completed"), body.replace("000000000001", "000000000002"), body.replace("\"2026-09-07T08:00:00Z\"", "null"), "invalid".into()] {
            assert!(reminder_boundary_fixture("200 OK", &invalid, true, target).await.is_err());
        }
        assert!(reminder_boundary_fixture("200 OK", &body, true, None).await.is_err());
        let clear_body = body.replace("\"2026-09-07T08:00:00Z\"", "null");
        assert!(reminder_boundary_fixture("200 OK", &clear_body, true, None).await.unwrap()[0].remind_at.is_none());
        for status in ["400 Bad Request", "403 Forbidden", "404 Not Found", "409 Conflict", "302 Found", "503 Unavailable"] {
            let error = reminder_boundary_fixture(status, "secret upstream body", true, target).await.unwrap_err();
            assert!(!error.contains("secret"));
        }
        let config = Config { base_url: "http://127.0.0.1:1".into(), token: "unit-only".into(), session_id: None };
        assert_eq!(set_reminder_http(&config, "../bad", target, None).await.unwrap_err(), "待办标识不正确");
        assert!(set_reminder_http(&config, &item.id, target, None).await.unwrap_err().contains("尚未确认"));
    }
    #[test]
    fn node_failure_preserves_control_connection_and_session() {
        let (sender, _rx) = mpsc::channel(1);
        let mut inner = Inner::default();
        inner.sender = Some(sender);
        inner.view.connection = "connected".into();
        inner.view.node_connected = true;
        inner.view.snapshot.session_id = "current-session".into();
        inner.view.snapshot.seq = 7;
        mark_node_disconnected(&mut inner, "设备租约暂时不可用".into());
        assert!(inner.sender.is_some());
        assert_eq!(inner.view.connection, "connected");
        assert_eq!(inner.view.snapshot.session_id, "current-session");
        assert_eq!(inner.view.snapshot.seq, 7);
        assert!(inner.view.error.is_none());
        assert!(!inner.view.node_connected);
        assert!(inner.view.node_error.is_some());
    }
    #[test]
    fn remote_credentials_require_tls_and_clean_origin() {
        assert!(normalized_url("http://example.com").is_err());
        assert!(normalized_url("https://secret@example.com").is_err());
        assert!(normalized_url("https://example.com?token=secret").is_err());
        assert!(normalized_url("http://127.0.0.1:8000").is_ok());
        assert!(normalized_url("https://example.com/").is_ok());
    }
}
