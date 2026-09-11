# Native baseline — 2026-09-08

Real installed debug bundle, before this task was packaged. CUA restarted the app, opened compact, then clicked 配置助手服务. AX first showed real connected compact UI. After settings click, screenshot was 940×760 with only the cat and full disk; AX exposed only the cat. A subsequent fresh AX call still reported no change. This is direct evidence that the native surface resized while the settings remained unavailable, not a measured animation frame-rate claim. No settings saved, model prompts sent, or business data seeded.

The source waits indefinitely for RAF before clearing the hidden state. The baseline supports investigating the rendering wait; there is no instrumentation proving exactly which promise is stalled. Rebuilt app comparison is required.
