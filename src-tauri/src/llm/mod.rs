pub mod sse;

pub use sse::{StreamChunk, ToolCallDelta};

use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;

/// Per-chunk read ceiling, enforced inside `sse::chunk_stream` at the raw byte
/// level so keep-alive traffic resets it; the request-level total timeout lives
/// on the client.
pub const CHUNK_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone)]
pub struct LlmConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub timeout_secs: u64,
}

/// Sanitized failure classes; provider bodies and credentials never surface.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LlmError {
    Timeout,
    Http(u16),
    Connect,
    Failed,
}

impl LlmError {
    pub fn message(&self) -> String {
        match self {
            Self::Timeout => "模型服务请求超时".into(),
            Self::Http(code) => format!("模型服务返回 HTTP {code}"),
            Self::Connect => "无法连接模型服务，请检查模型服务地址和服务状态".into(),
            Self::Failed => "模型或任务执行失败".into(),
        }
    }
}

fn classify(error: reqwest::Error) -> LlmError {
    if error.is_timeout() {
        LlmError::Timeout
    } else if error.is_connect() {
        LlmError::Connect
    } else if let Some(status) = error.status() {
        LlmError::Http(status.as_u16())
    } else {
        LlmError::Failed
    }
}

/// One complete model function call, assembled from streamed deltas.
/// `arguments` is the raw JSON string exactly as the model produced it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

impl ModelToolCall {
    /// OpenAI wire shape used when the call is fed back as an assistant message.
    pub fn wire(&self) -> Value {
        json!({
            "id": self.id,
            "type": "function",
            "function": {"name": self.name, "arguments": self.arguments},
        })
    }

    pub fn parsed_arguments(&self) -> Option<Value> {
        serde_json::from_str(&self.arguments).ok()
    }
}

/// Merges streamed tool_call deltas by index into complete calls.
#[derive(Default)]
pub struct ToolCallAccumulator {
    pending: Vec<ModelToolCall>,
}

impl ToolCallAccumulator {
    pub fn push(&mut self, deltas: &[ToolCallDelta]) {
        for delta in deltas {
            if self.pending.len() <= delta.index {
                self.pending.resize_with(delta.index + 1, || ModelToolCall {
                    id: String::new(),
                    name: String::new(),
                    arguments: String::new(),
                });
            }
            let pending = &mut self.pending[delta.index];
            if let Some(id) = &delta.id {
                pending.id.push_str(id);
            }
            if let Some(name) = &delta.name {
                pending.name.push_str(name);
            }
            if let Some(arguments) = &delta.arguments {
                pending.arguments.push_str(arguments);
            }
        }
    }

    /// `Err(())` mirrors the server's invalid_tool_calls rejection: missing
    /// identity or arguments that are not valid JSON fail the whole step.
    pub fn finish(mut self) -> Result<Vec<ModelToolCall>, ()> {
        self.pending.retain(|call| {
            !(call.id.is_empty() && call.name.is_empty() && call.arguments.is_empty())
        });
        for call in &mut self.pending {
            if call.id.is_empty() || call.name.is_empty() || call.id.len() > 256 {
                return Err(());
            }
            if call.arguments.is_empty() {
                call.arguments = "{}".into();
            }
            if call.parsed_arguments().is_none() {
                return Err(());
            }
        }
        Ok(self.pending)
    }
}

#[derive(Clone, Serialize)]
pub struct ChatMessage {
    pub role: &'static str,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl ChatMessage {
    pub fn text(role: &'static str, content: String) -> Self {
        Self {
            role,
            content,
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    /// Assistant turn that requested tool calls; content may be empty.
    pub fn assistant(content: String, calls: &[ModelToolCall]) -> Self {
        Self {
            role: "assistant",
            content,
            tool_calls: Some(calls.iter().map(ModelToolCall::wire).collect()),
            tool_call_id: None,
            name: None,
        }
    }

    /// Tool result fed back to the model; content is the JSON body string.
    pub fn tool(call: &ModelToolCall, content: String) -> Self {
        Self {
            role: "tool",
            content,
            tool_calls: None,
            tool_call_id: Some(call.id.clone()),
            name: Some(call.name.clone()),
        }
    }
}

pub struct OpenAiClient {
    config: LlmConfig,
    http: reqwest::Client,
}

impl OpenAiClient {
    pub fn new(config: LlmConfig) -> Result<Self, LlmError> {
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(config.timeout_secs.max(1)))
            .build()
            .map_err(|_| LlmError::Failed)?;
        Ok(Self { config, http })
    }

    pub async fn chat_stream(
        &self,
        messages: &[ChatMessage],
        tools: Option<&[Value]>,
    ) -> Result<impl futures_util::Stream<Item = Result<StreamChunk, LlmError>>, LlmError> {
        self.chat_stream_with_limit(messages, tools, None).await
    }

    pub async fn chat_stream_with_limit(
        &self,
        messages: &[ChatMessage],
        tools: Option<&[Value]>,
        max_completion_tokens: Option<usize>,
    ) -> Result<impl futures_util::Stream<Item = Result<StreamChunk, LlmError>>, LlmError> {
        let mut body = json!({
            "model": self.config.model,
            "messages": messages,
            "stream": true,
            "stream_options": {"include_usage": true},
        });
        if let Some(limit) = max_completion_tokens {
            body["max_completion_tokens"] = json!(limit);
        }
        if let Some(tools) = tools {
            body["tools"] = Value::Array(tools.to_vec());
            body["parallel_tool_calls"] = Value::Bool(false);
        }
        let response = self
            .http
            .post(format!("{}/chat/completions", self.config.base_url))
            .bearer_auth(&self.config.api_key)
            .json(&body)
            .send()
            .await
            .map_err(classify)?;
        if !response.status().is_success() {
            return Err(LlmError::Http(response.status().as_u16()));
        }
        Ok(sse::chunk_stream(response))
    }
}

pub async fn list_models(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "无法初始化模型查询")?;
    let request = client.get(format!("{base_url}/models"));
    let request = if api_key.is_empty() {
        request
    } else {
        request.bearer_auth(api_key)
    };
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            "模型列表查询超时".to_owned()
        } else {
            "无法连接模型服务，请检查模型服务地址和服务状态".to_owned()
        }
    })?;
    if !response.status().is_success() {
        return Err(format!(
            "模型列表查询失败（{}）",
            response.status().as_u16()
        ));
    }
    #[derive(serde::Deserialize)]
    struct ModelEntry {
        id: String,
    }
    #[derive(serde::Deserialize)]
    struct ModelList {
        data: Vec<ModelEntry>,
    }
    let list: ModelList = response.json().await.map_err(|_| "模型列表格式不正确")?;
    Ok(list.data.into_iter().map(|entry| entry.id).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_messages_are_fixed_and_credential_free() {
        assert_eq!(LlmError::Timeout.message(), "模型服务请求超时");
        assert_eq!(LlmError::Http(503).message(), "模型服务返回 HTTP 503");
        assert!(LlmError::Connect.message().contains("无法连接模型服务"));
        assert_eq!(LlmError::Failed.message(), "模型或任务执行失败");
    }

    fn delta(
        index: usize,
        id: Option<&str>,
        name: Option<&str>,
        arguments: Option<&str>,
    ) -> ToolCallDelta {
        ToolCallDelta {
            index,
            id: id.map(str::to_owned),
            name: name.map(str::to_owned),
            arguments: arguments.map(str::to_owned),
        }
    }

    #[test]
    fn accumulator_merges_streamed_fragments_by_index() {
        let mut acc = ToolCallAccumulator::default();
        acc.push(&[delta(
            0,
            Some("call_1"),
            Some("todo_create"),
            Some("{\"tit"),
        )]);
        acc.push(&[delta(1, Some("call_2"), Some("todo_list"), None)]);
        acc.push(&[delta(0, None, None, Some("le\":\"喝水\"}"))]);
        acc.push(&[delta(1, None, None, Some("{}"))]);
        let calls = acc.finish().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].id, "call_1");
        assert_eq!(calls[0].name, "todo_create");
        assert_eq!(
            calls[0].parsed_arguments().unwrap(),
            json!({"title": "喝水"})
        );
        assert_eq!(calls[1].name, "todo_list");
    }

    #[test]
    fn accumulator_rejects_invalid_tool_calls() {
        let mut missing_id = ToolCallAccumulator::default();
        missing_id.push(&[delta(0, None, Some("todo_list"), Some("{}"))]);
        assert!(missing_id.finish().is_err());
        let mut bad_json = ToolCallAccumulator::default();
        bad_json.push(&[delta(0, Some("call_1"), Some("todo_list"), Some("{bad"))]);
        assert!(bad_json.finish().is_err());
        let mut blank_arguments = ToolCallAccumulator::default();
        blank_arguments.push(&[delta(0, Some("call_1"), Some("todo_list"), None)]);
        let calls = blank_arguments.finish().unwrap();
        assert_eq!(calls[0].arguments, "{}");
    }

    #[test]
    fn chat_messages_serialize_in_openai_wire_shape() {
        let plain = serde_json::to_value(ChatMessage::text("user", "你好".into())).unwrap();
        assert_eq!(plain, json!({"role": "user", "content": "你好"}));
        let call = ModelToolCall {
            id: "call_1".into(),
            name: "todo_create".into(),
            arguments: "{\"title\":\"喝水\"}".into(),
        };
        let assistant = serde_json::to_value(ChatMessage::assistant(
            String::new(),
            std::slice::from_ref(&call),
        ))
        .unwrap();
        assert_eq!(
            assistant,
            json!({"role": "assistant", "content": "", "tool_calls": [
                {"id": "call_1", "type": "function",
                 "function": {"name": "todo_create", "arguments": "{\"title\":\"喝水\"}"}}
            ]})
        );
        let tool = serde_json::to_value(ChatMessage::tool(&call, "{\"item\":{}}".into())).unwrap();
        assert_eq!(
            tool,
            json!({"role": "tool", "content": "{\"item\":{}}", "tool_call_id": "call_1", "name": "todo_create"})
        );
    }

    /// Local test socket only: asserts the exact request body (tools +
    /// parallel_tool_calls=false) and end-to-end SSE delta/tool accumulation.
    #[tokio::test]
    async fn chat_stream_sends_tools_and_accumulates_streamed_calls() {
        use futures_util::StreamExt;
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let tools = vec![json!({"type": "function", "function": {"name": "todo_list",
            "description": "d", "parameters": {"type": "object"}}})];
        let body = std::sync::Arc::new(std::sync::Mutex::new(Value::Null));
        let captured = body.clone();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = Vec::new();
            loop {
                let mut buffer = [0; 4096];
                let size = socket.read(&mut buffer).unwrap();
                assert!(size > 0);
                request.extend_from_slice(&buffer[..size]);
                let Some(boundary) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n")
                else {
                    continue;
                };
                let headers = String::from_utf8_lossy(&request[..boundary]).to_lowercase();
                assert!(headers.starts_with("post /chat/completions "));
                assert!(headers.contains("authorization: bearer unit-only"));
                let length: usize = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length: "))
                    .unwrap()
                    .parse()
                    .unwrap();
                if request.len() < boundary + 4 + length {
                    continue;
                }
                *captured.lock().unwrap() =
                    serde_json::from_slice(&request[boundary + 4..boundary + 4 + length]).unwrap();
                break;
            }
            let chunks = [
                json!({"choices":[{"delta":{"content":"好的"},"finish_reason":null}]}),
                json!({"choices":[{"delta":{"reasoning_content":"隐藏"},"finish_reason":null}]}),
                json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"todo_list","arguments":"{"}}]},"finish_reason":null}]}),
                json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]},"finish_reason":"tool_calls"}]}),
            ];
            let mut payload = String::new();
            for chunk in chunks {
                payload.push_str(&format!("data: {chunk}\n\n"));
            }
            payload.push_str("data: [DONE]\n\n");
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
                        payload.len()
                    )
                    .as_bytes(),
                )
                .unwrap();
        });
        let client = OpenAiClient::new(LlmConfig {
            base_url: format!("http://{address}"),
            api_key: "unit-only".into(),
            model: "unit-model".into(),
            timeout_secs: 5,
        })
        .unwrap();
        let stream = client
            .chat_stream(&[ChatMessage::text("user", "查一下".into())], Some(&tools))
            .await
            .unwrap();
        let mut accumulator = ToolCallAccumulator::default();
        let mut text = String::new();
        let mut stream = Box::pin(stream);
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.unwrap();
            text.push_str(&chunk.content);
            accumulator.push(&chunk.tool_calls);
        }
        server.join().unwrap();
        assert_eq!(text, "好的");
        let calls = accumulator.finish().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "todo_list");
        assert_eq!(calls[0].parsed_arguments().unwrap(), json!({}));
        let body = body.lock().unwrap().clone();
        assert_eq!(body["model"], json!("unit-model"));
        assert_eq!(body["stream"], json!(true));
        assert_eq!(body["parallel_tool_calls"], json!(false));
        assert_eq!(body["tools"], json!(tools));
        assert!(body["temperature"].is_null());
    }
}
