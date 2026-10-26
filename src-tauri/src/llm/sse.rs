use super::{classify, LlmError, CHUNK_TIMEOUT};
use eventsource_stream::{EventStreamError, Eventsource};
use futures_util::{Stream, StreamExt};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// One streamed function-call fragment; `index` groups fragments of one call.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ToolCallDelta {
    pub index: usize,
    pub id: Option<String>,
    pub name: Option<String>,
    pub arguments: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct StreamChunk {
    /// Visible text only; reasoning/thinking content is dropped at parse time.
    pub content: String,
    pub tool_calls: Vec<ToolCallDelta>,
    pub finish_reason: Option<String>,
    pub usage: Option<ProviderUsage>,
}

/// Only allowlisted numeric provider counters; never copy response bodies.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct ProviderUsage {
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    pub prompt_tokens_details: Option<PromptTokenDetails>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct PromptTokenDetails {
    pub cached_tokens: Option<u64>,
}

#[derive(Deserialize)]
struct ChatCompletionChunk {
    #[serde(default)]
    choices: Vec<ChunkChoice>,
    usage: Option<ProviderUsage>,
}

#[derive(Deserialize)]
struct ChunkChoice {
    #[serde(default)]
    delta: ChunkDelta,
    finish_reason: Option<String>,
}

#[derive(Deserialize, Default)]
struct ChunkDelta {
    content: Option<String>,
    tool_calls: Option<Vec<ToolCallDeltaRaw>>,
    /// Provider reasoning/thinking channels (visible_text semantics: dropped).
    #[serde(default, rename = "reasoning_content")]
    _reasoning_content: Option<serde::de::IgnoredAny>,
}

#[derive(Deserialize)]
struct ToolCallDeltaRaw {
    index: Option<usize>,
    id: Option<String>,
    function: Option<ToolCallFunctionDelta>,
}

#[derive(Deserialize)]
struct ToolCallFunctionDelta {
    name: Option<String>,
    arguments: Option<String>,
}

/// `Ok(None)` marks the terminal `[DONE]` sentinel; parse failures are sanitized.
fn parse_chunk(data: &str) -> Result<Option<Option<StreamChunk>>, LlmError> {
    if data.trim() == "[DONE]" {
        return Ok(None);
    }
    // Keep-alive payloads (proxies may send blank/whitespace `data:` lines)
    // carry no chunk; skip them instead of failing the run on a parse error.
    if data.trim().is_empty() {
        return Ok(Some(None));
    }
    let chunk: ChatCompletionChunk = serde_json::from_str(data).map_err(|_| LlmError::Failed)?;
    let usage = chunk.usage;
    let parsed = chunk.choices.into_iter().next().map(|choice| StreamChunk {
        content: choice.delta.content.unwrap_or_default(),
        tool_calls: choice
            .delta
            .tool_calls
            .unwrap_or_default()
            .into_iter()
            .map(|raw| {
                let function = raw.function.unwrap_or(ToolCallFunctionDelta {
                    name: None,
                    arguments: None,
                });
                ToolCallDelta {
                    index: raw.index.unwrap_or(0),
                    id: raw.id,
                    name: function.name,
                    arguments: function.arguments,
                }
            })
            .collect(),
        finish_reason: choice.finish_reason,
        usage: usage.clone(),
    });
    Ok(Some(parsed.or_else(|| {
        usage.map(|usage| StreamChunk {
            usage: Some(usage),
            ..StreamChunk::default()
        })
    })))
}

pub fn chunk_stream(
    response: reqwest::Response,
) -> impl Stream<Item = Result<StreamChunk, LlmError>> + Send {
    chunk_stream_with_timeout(response, CHUNK_TIMEOUT)
}

/// The per-chunk read ceiling wraps the raw byte stream, so any provider
/// keep-alive traffic (SSE comment lines, blank `data:` heartbeats) resets the
/// timer even though it never surfaces as a parsed event. After one silent
/// stretch the stream yields `LlmError::Timeout` once and ends.
fn chunk_stream_with_timeout(
    response: reqwest::Response,
    timeout: Duration,
) -> impl Stream<Item = Result<StreamChunk, LlmError>> + Send {
    let bytes = futures_util::stream::unfold(
        Some(Box::pin(response.bytes_stream())),
        move |state| async move {
            let mut stream = state?;
            match tokio::time::timeout(timeout, stream.next()).await {
                Err(_) => Some((Err(LlmError::Timeout), None)),
                Ok(Some(Ok(bytes))) => Some((Ok(bytes), Some(stream))),
                Ok(Some(Err(error))) => Some((Err(classify(error)), Some(stream))),
                Ok(None) => None,
            }
        },
    );
    bytes
        .eventsource()
        .map(|event| match event {
            Ok(event) => parse_chunk(&event.data),
            Err(EventStreamError::Transport(error)) => Err(error),
            Err(_) => Err(LlmError::Failed),
        })
        .take_while(|item| std::future::ready(!matches!(item, Ok(None))))
        .filter_map(|item| async move {
            match item {
                Ok(Some(chunk)) => chunk.map(Ok),
                Ok(None) => None,
                Err(error) => Some(Err(error)),
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_text_and_tool_call_deltas() {
        let text = parse_chunk(
            &json!({"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}).to_string(),
        )
        .unwrap()
        .flatten()
        .unwrap();
        assert_eq!(text.content, "你好");
        assert!(text.tool_calls.is_empty());
        let tool = parse_chunk(
            &json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"todo_list","arguments":"{}"}}]},"finish_reason":"tool_calls"}]})
                .to_string(),
        )
        .unwrap()
        .flatten()
        .unwrap();
        assert_eq!(tool.content, "");
        assert_eq!(
            tool.tool_calls,
            vec![ToolCallDelta {
                index: 0,
                id: Some("call_1".into()),
                name: Some("todo_list".into()),
                arguments: Some("{}".into()),
            }]
        );
        assert_eq!(tool.finish_reason.as_deref(), Some("tool_calls"));
        let fragment = parse_chunk(
            &json!({"choices":[{"delta":{"tool_calls":[{"index":2,"function":{"arguments":"{\"a\":"}}]}}]})
                .to_string(),
        )
        .unwrap()
        .flatten()
        .unwrap();
        assert_eq!(
            fragment.tool_calls,
            vec![ToolCallDelta {
                index: 2,
                id: None,
                name: None,
                arguments: Some("{\"a\":".into()),
            }]
        );
    }

    #[test]
    fn reasoning_content_is_parsed_but_never_propagated() {
        let chunk = parse_chunk(
            &json!({"choices":[{"delta":{"content":"可见","reasoning_content":"隐藏推理"},"finish_reason":null}]})
                .to_string(),
        )
        .unwrap()
        .flatten()
        .unwrap();
        assert_eq!(chunk.content, "可见");
        // The parsed chunk has no reasoning field at all: nothing to leak.
        assert!(!format!("{chunk:?}").contains("隐藏推理"));
        let reasoning_only = parse_chunk(
            &json!({"choices":[{"delta":{"reasoning_content":"隐藏推理"},"finish_reason":null}]})
                .to_string(),
        )
        .unwrap()
        .flatten()
        .unwrap();
        assert_eq!(reasoning_only.content, "");
    }

    #[test]
    fn done_sentinel_and_empty_choices() {
        assert_eq!(parse_chunk("[DONE]").unwrap(), None);
        assert_eq!(
            parse_chunk(&json!({"choices":[]}).to_string()).unwrap(),
            Some(None)
        );
        assert_eq!(parse_chunk("").unwrap(), Some(None));
        assert_eq!(parse_chunk("  ").unwrap(), Some(None));
        assert!(parse_chunk("not json").is_err());
    }

    #[test]
    fn usage_only_chunk_is_preserved_without_becoming_visible_text() {
        let chunk = parse_chunk(
            &json!({"choices":[], "usage": {
                "prompt_tokens": 120, "completion_tokens": 12, "total_tokens":132,
                "prompt_tokens_details": {"cached_tokens": 64},
                "provider_extra": "must not be retained"
            }})
            .to_string(),
        )
        .unwrap()
        .flatten()
        .unwrap();
        assert!(chunk.content.is_empty() && chunk.tool_calls.is_empty());
        let usage = chunk.usage.unwrap();
        assert_eq!(usage.prompt_tokens, Some(120));
        assert_eq!(usage.prompt_tokens_details.unwrap().cached_tokens, Some(64));
    }

    /// Local test socket: responds to a POST with an SSE body terminated by
    /// connection close. `body` runs against the accepted socket.
    fn serve_once(body: impl FnOnce(std::net::TcpStream) + Send + 'static) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = Vec::new();
            let mut buffer = [0; 4096];
            loop {
                let size = socket.read(&mut buffer).unwrap();
                assert!(size > 0);
                request.extend_from_slice(&buffer[..size]);
                if request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                    break;
                }
            }
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n")
                .unwrap();
            body(socket);
        });
        format!("http://{address}")
    }

    async fn post(base: &str) -> reqwest::Response {
        reqwest::Client::new()
            .post(format!("{base}/chat/completions"))
            .json(&json!({"model": "unit", "messages": [], "stream": true}))
            .send()
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn heartbeat_comments_reset_the_chunk_timer() {
        use std::io::Write;
        let base = serve_once(move |mut socket| {
            // Heartbeats for roughly 4x the chunk timeout, then the real chunk.
            for _ in 0..12 {
                socket.write_all(b": keep-alive\n\n").unwrap();
                std::thread::sleep(Duration::from_millis(25));
            }
            let chunk = json!({"choices":[{"delta":{"content":"晚"},"finish_reason":"stop"}]});
            socket
                .write_all(format!("data: {chunk}\n\ndata: [DONE]\n\n").as_bytes())
                .unwrap();
        });
        let response = post(&base).await;
        let mut stream = Box::pin(chunk_stream_with_timeout(
            response,
            Duration::from_millis(80),
        ));
        let mut text = String::new();
        while let Some(item) = stream.next().await {
            text.push_str(&item.unwrap().content);
        }
        assert_eq!(text, "晚");
    }

    #[tokio::test]
    async fn a_silent_stream_times_out_once_and_ends() {
        let base = serve_once(move |socket| {
            // Nothing but the open connection; closing after the test's timer.
            std::thread::sleep(Duration::from_millis(400));
            drop(socket);
        });
        let response = post(&base).await;
        let mut stream = Box::pin(chunk_stream_with_timeout(
            response,
            Duration::from_millis(80),
        ));
        let item = stream.next().await.unwrap();
        assert_eq!(item.unwrap_err(), LlmError::Timeout);
        assert!(
            stream.next().await.is_none(),
            "the stream ends after one timeout"
        );
    }
}
