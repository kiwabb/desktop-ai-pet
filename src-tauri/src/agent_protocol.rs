use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    User,
    Assistant,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Interrupted,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    Running,
    Completed,
    Failed,
    NeedsReconciliation,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Message {
    pub id: String,
    pub role: Role,
    pub content: String,
    pub created_at: String,
    pub run_id: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ToolCall {
    pub id: String,
    pub run_id: String,
    pub name: String,
    pub status: ToolStatus,
    pub result: Option<Value>,
    pub error: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Run {
    pub id: String,
    pub request_id: String,
    pub status: RunStatus,
    pub error: Option<String>,
}
#[derive(Clone, Default, Debug, Deserialize, Serialize)]
pub struct Snapshot {
    pub session_id: String,
    pub seq: u64,
    pub messages: Vec<Message>,
    pub tool_calls: Vec<ToolCall>,
    pub runs: Vec<Run>,
}
#[derive(Deserialize)]
pub struct Envelope {
    pub v: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub session_id: Option<String>,
    pub request_id: Option<String>,
    pub seq: Option<u64>,
    pub payload: Value,
}
fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|_| "服务端消息格式不正确".into())
}
impl Snapshot {
    pub fn apply(&mut self, event: &Envelope) -> Result<bool, String> {
        if event.v != 1 {
            return Err("服务端协议版本不兼容".into());
        }
        if event.kind == "session.snapshot" {
            let next: Snapshot = decode(event.payload.clone())?;
            if event.seq != Some(next.seq)
                || event.session_id.as_deref() != Some(next.session_id.as_str())
            {
                return Err("会话快照水位不一致".into());
            }
            *self = next;
            return Ok(true);
        }
        if event.session_id.as_deref() != Some(self.session_id.as_str()) {
            return Ok(false);
        }
        let seq = event.seq.ok_or("持久事件缺少序号")?;
        if seq <= self.seq {
            return Ok(false);
        }
        if seq != self.seq + 1 {
            return Err("消息序号中断，正在重新同步".into());
        }
        match event.kind.as_str() {
            "run.accepted" => {
                let run: Run = decode(event.payload["run"].clone())?;
                let user: Message = decode(event.payload["user_message"].clone())?;
                let assistant: Message = decode(event.payload["assistant_message"].clone())?;
                if !self.runs.iter().any(|r| r.id == run.id) {
                    self.runs.push(run);
                }
                for message in [user, assistant] {
                    if !self.messages.iter().any(|m| m.id == message.id) {
                        self.messages.push(message);
                    }
                }
            }
            "message.delta" => {
                let id = event.payload["message_id"].as_str().ok_or("消息缺少标识")?;
                let text = event.payload["text"].as_str().ok_or("消息缺少内容")?;
                let message = self
                    .messages
                    .iter_mut()
                    .find(|m| m.id == id)
                    .ok_or("消息尚未同步")?;
                message.content.push_str(text);
            }
            "tool.started" | "tool.finished" => {
                let tool: ToolCall = decode(event.payload["tool_call"].clone())?;
                if let Some(old) = self.tool_calls.iter_mut().find(|t| t.id == tool.id) {
                    *old = tool;
                } else {
                    self.tool_calls.push(tool);
                }
            }
            "run.started" | "run.completed" | "run.failed" | "run.interrupted" => {
                let run: Run = decode(event.payload["run"].clone())?;
                if let Some(old) = self.runs.iter_mut().find(|r| r.id == run.id) {
                    *old = run;
                } else {
                    return Err("任务尚未同步".into());
                }
            }
            _ => return Err("收到不支持的持久事件".into()),
        }
        self.seq = seq;
        Ok(true)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn duplicates_and_gaps_do_not_mutate_projection() {
        let mut s = Snapshot {
            session_id: "s".into(),
            seq: 3,
            ..Default::default()
        };
        let make = |seq| Envelope {
            v: 1,
            kind: "message.delta".into(),
            session_id: Some("s".into()),
            request_id: None,
            seq: Some(seq),
            payload: json!({"message_id":"missing", "text":"x"}),
        };
        assert!(!s.apply(&make(3)).unwrap());
        assert!(s.apply(&make(5)).is_err());
        assert_eq!(s.seq, 3);
    }
}
