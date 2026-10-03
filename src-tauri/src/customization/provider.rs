//! Image edits only: explicit requests, no automatic retries and no raw errors.
use super::Settings;
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::StreamExt;
use std::time::Duration;

const MAX_RESPONSE: usize = 28 * 1024 * 1024;
pub async fn edit(
    settings: &Settings,
    key: &str,
    images: Vec<Vec<u8>>,
    stage: &str,
) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|_| "无法初始化图片连接")?;
    let prompt = if stage == "base" {
        "Create exactly one cute full-body desktop companion character faithfully based on the supplied references. Preserve the subject's identity, colors and distinguishing features. A friendly seated front-facing pose, eyes open, neutral gentle expression. Soft polished illustrated 3D-like toy style. No floor, props, text, frame, shadow outside the subject, duplicate characters or decorations. REAL transparent alpha background, not a painted checkerboard. Entire character must fit comfortably inside the canvas with clear transparent margins. Single subject, upright, feet level. Output PNG."
    } else {
        match stage {
            "badge" => "Create one cute paw-shaped companion badge based on this character reference. Match its fur colors, paw pad colors and soft rounded illustrated style. Exactly three rounded toe pads above one larger paw pad, compact bold readable silhouette at 28 pixels. One paw only, not a cat face, avatar or second cat. No text, frame, tile, floor, base, props or cast shadow. Centered on a square canvas with small transparent margins. REAL transparent alpha PNG background, not a checkerboard. Preserve characteristic colors.",
            "closed" => "Edit the first reference character: close both eyes naturally for peaceful rest. Preserve exactly the same character, identity, colors, sitting pose, full-body shape, camera, scale and proportions. Change only the expression. Single character; real transparent alpha PNG background, transparent margins, no floor or cast shadow, no checkerboard, props or text.",
            "happy" => "Edit the first reference character: a visibly delighted happy facial expression, eyes smiling. Preserve exactly the same character, identity, colors, sitting pose, full-body shape, camera, scale and proportions. Change only the expression. Single character; real transparent alpha PNG background, transparent margins, no floor or cast shadow, no checkerboard, props or text.",
            "talk" => "Edit the first reference character: slightly open the mouth in a friendly speaking expression, eyes open. Preserve exactly the same character, identity, colors, sitting pose, full-body shape, camera, scale and proportions. Change only the expression. Single character; real transparent alpha PNG background, transparent margins, no floor or cast shadow, no checkerboard, props or text.",
            _ => return Err("无效的图片生成阶段".into()),
        }
    };
    let mut form = reqwest::multipart::Form::new()
        .text("model", settings.model.clone())
        .text("prompt", prompt)
        .text("n", "1")
        .text(
            "size",
            if stage == "badge" {
                "1024x1024"
            } else {
                "1024x1536"
            },
        )
        .text("background", "transparent")
        .text("output_format", "png");
    for (i, image) in images.into_iter().enumerate() {
        let part = reqwest::multipart::Part::bytes(image)
            .file_name(format!("reference-{i}.png"))
            .mime_str("image/png")
            .map_err(|_| "无法准备参考图片")?;
        form = form.part("image[]", part);
    }
    let mut request = client
        .post(format!("{}/images/edits", settings.base_url))
        .multipart(form);
    if !key.is_empty() {
        request = request.bearer_auth(key);
    }
    let response = request.send().await.map_err(|e| {
        if e.is_timeout() {
            "图片生成等待超时；服务端仍可能计费，请检查后手动重试"
        } else {
            "图片服务连接失败；未自动重试，请检查地址与网络"
        }
    })?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401|403=>"图片服务拒绝授权，请检查独立的图片 API Key 和模型权限".into(),
            429=>"图片服务额度不足或请求受限；请检查后手动重试".into(),
            code=>format!("图片服务返回 HTTP {code}；需要支持透明 PNG 与 base64 输出的 images/edits 接口。未自动重试"),
        });
    }
    if response
        .content_length()
        .is_some_and(|n| n > MAX_RESPONSE as u64)
    {
        return Err("图片服务响应超过 28 MiB 限制".into());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "图片服务响应中断；未自动重试")?;
        if bytes.len() + chunk.len() > MAX_RESPONSE {
            return Err("图片服务响应超过 28 MiB 限制".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    parse(&bytes)
}
fn parse(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| "图片服务返回的内容不是有效 JSON")?;
    let data = value
        .get("data")
        .and_then(|v| v.as_array())
        .filter(|v| v.len() == 1)
        .ok_or("图片服务未返回一张有效图片")?;
    let text = data[0]
        .get("b64_json")
        .and_then(|v| v.as_str())
        .ok_or("图片服务必须直接返回 b64_json 透明 PNG；不支持远程图片 URL")?;
    if text.len() > 20 * 1024 * 1024 / 3 * 4 {
        return Err("图片超过大小限制".into());
    }
    STANDARD
        .decode(text)
        .map_err(|_| "图片服务返回了无效 base64 图片".into())
}
pub fn credential(account: &str) -> Result<keyring::Entry, String> {
    if !super::storage::valid_id(account) {
        return Err("图片凭据标识无效".into());
    }
    keyring::Entry::new("desktop-ai-pet-images", account)
        .map_err(|_| "系统图片凭据存储不可用".into())
}
pub fn key(settings: &Settings) -> Result<String, String> {
    match &settings.key_account {
        None => Ok(String::new()),
        Some(account) => credential(account)?
            .get_password()
            .map_err(|_| "无法读取图片 API Key，请在图片服务设置中重新保存".into()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_remote_urls_and_provider_error_details() {
        assert!(
            parse(br#"{"data":[{"url":"https://example.com/private"}]}"#)
                .unwrap_err()
                .contains("b64_json")
        );
        let error = parse(br#"{"error":{"message":"secret"}}"#).unwrap_err();
        assert!(!error.contains("secret"));
        assert_eq!(parse(br#"{"data":[{"b64_json":"aGk="}]}"#).unwrap(), b"hi");
    }
}
