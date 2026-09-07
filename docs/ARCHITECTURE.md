# 桌面 AI 白猫技术架构

> 2026-09-07：本文保留桌面直连模型的原有架构说明。已确认的服务端智能体与跨设备方向见 [服务端智能体架构](SERVER_AGENT_ARCHITECTURE.md)；该方向尚未实现，不能将规划图视为当前运行状态。

本文解释桌宠窗口、2D 动画和真实 AI 对话之间的边界。第一版只覆盖一条用户流程：桌面常驻白猫、点击打开对话、输入文字、接收真实流式回复、收起聊天。

## 运行边界

```text
macOS / Windows
└─ Tauri 2
   ├─ Rust 原生层
   │  ├─ 宠物透明置顶窗口
   │  ├─ 对话透明置顶窗口
   │  ├─ 本地模型配置
   │  └─ OpenAI-compatible SSE 请求
   └─ React WebView
      ├─ PetStage
      ├─ ChatPanel
      ├─ PetState 状态机
      └─ LayeredPetRenderer
         ├─ idle.png
         ├─ blink.png
         └─ talk.png
```

## 双窗口

宠物窗口保持小尺寸，避免透明区域拦截桌面点击。聊天使用独立窗口按需显示，两个窗口通过 Tauri 事件同步宠物状态。

macOS 将两个窗口转换为浮动 `NSPanel`，并启用跨 Space 和全屏辅助标志。应用不能覆盖登录界面、锁屏、屏幕保护程序或受系统保护的安全界面。

## 2D 动画

`pet-2d-renderer.ts` 预加载三张 `1207×1303` 透明 PNG。它根据 `idle`、`curious`、`thinking`、`talking`、`happy`、`sleeping` 和 `error` 状态切换画面，并安排随机眨眼。

CSS 负责呼吸、轻微位移、说话切帧和拖拽形变。三张图片共用相同画布和角色位置，因此状态切换不会改变白猫轮廓。

应用只加载上述 PNG，不加载任何骨骼工程、Atlas 或 3D 模型。

## AI 配置

设置界面通过 Tauri IPC 将 API Key 交给 Rust。Rust 将配置写入应用配置目录，并在 macOS 和 Unix 上设置 `0600` 权限。浏览器存储和日志都不保存 API Key。

设置页调用 OpenAI-compatible `GET /models` 并读取 `data[].id`。接口不可用或返回非标准结构时，应用不伪造模型列表，仍允许手工输入模型名称。

## 状态转换

```text
idle ──发送──> thinking ──首个 token──> talking ──done──> happy ──900ms──> idle
                               └──错误──────────────────────> error
```

## 验收边界

- `pnpm pet2d:validate` 证明三张图片对齐，并且旧渲染依赖未进入运行边界。
- `pnpm build` 证明前端可以编译，不证明桌面窗口可见。
- 可见 Tauri 窗口证明桌面运行，不证明 AI 服务已调用。
- 界面收到并显示真实 SSE token，才证明对话链路完成。
