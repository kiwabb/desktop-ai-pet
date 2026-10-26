# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

The frontend uses Vitest (`pnpm test`) for focused behavioral regressions and
has no ESLint configuration. TypeScript builds, resource/contract verifiers,
and real runtime acceptance provide separate evidence. Tests never seed the
product database or replace the real backend just to make a demo look complete.
Follow the acceptance boundary in `docs/ARCHITECTURE.md`; a passing build does
not establish a usable native interaction or a real model invocation.

---

## Forbidden Patterns

- **假数据 / 假回复**：接口失败就显示错误；未配置 AI 服务就禁用发送。
  不生成模拟模型列表、模拟聊天回复（README 与 ARCHITECTURE 的硬性约束）
- **emoji 当图标**：统一 `lucide-react`（用户全局规范，见 AGENTS.md 之外
  的项目惯例：`ChatPanel.tsx:1` 的 import）
- **API Key 进浏览器存储 / 日志**：只走 Rust 层本地文件（`0600`）
- **旧的渲染依赖**：骨骼动画 / Atlas / 3D 运行时禁止进入运行边界，
  `pnpm pet2d:validate` 会检查
- 不要在 UI 文案里用英文——面向用户的中文文案（`petStateLabel`、
  按钮 aria-label、占位符都是中文）

## Required Patterns

- 每个 `useEffect` 配完整 cleanup（监听器 unlisten、timer clear）
- 异步回调里的 `invoke` 用 `void` 前缀标记有意不等待（`void invoke(...)`）
- 错误信息进 state 显示给用户（`role="alert"`），同时 `console.error` 留上下文，
  文案用中文：如 `console.error('重置桌宠位置失败', cause)`
- 错误提示按发生场景转换一次，保留原始日志或运行记录；设置接口的 404 不得显示“待办不存在”。只有当前运行存在工具记录时才能提示核对执行记录，且不能把失败或未确认记录描述为成功结果。
- 修改宠物动画资源后必须跑 `pnpm pet2d:validate`（校验三帧对齐）

## Testing Requirements

- Reuse the existing Vitest setup for meaningful behavior regressions. Do not add another test framework or tests that only mirror CSS literals.
- 验证命令（`README.md`）：

  ```bash
  pnpm test            # focused frontend behavioral regressions
  pnpm pet2d:validate   # 图片尺寸 / 渲染入口 / 禁用依赖检查
  pnpm build            # tsc -b && vite build，类型错误在此暴露
  cargo check --manifest-path src-tauri/Cargo.toml   # Rust 侧
  ```

- 涉及桌面窗口行为的改动（拖拽、resize、置顶、跨 Space），编译通过**不算**
  验证完成——需要 `pnpm tauri dev` 实际运行确认，并在交付说明里写明
  验证到哪一级

### Reusable frame regression checks

- Verify the frame in an entry that does **not** import application CSS or
  ChatPanel. Removing host ancestor classes alone does not establish isolation.
- Measure compact header bounds against the body: a 48px grid row must not
  contain a 58px content-box header. Also test a normal-flow frame inside a page
  that imports application CSS to catch leaked desktop positioning.
- Check both appearances with reduced motion enabled, and check a committed
  `visible=true -> false -> true` sequence with `animateEntrance=true`: the
  animation must restart after reopening. Reduced motion must disable spatial
  transforms/bounce; the integrated initial reveal may use a bounded 160ms
  opacity-only dissolve. Inspect computed styles because global animation resets
  can accidentally disable that dissolve.
- QA React callers must be included in TypeScript validation when public props
  change. Use neutral frame slots or the actual unavailable/unconfigured state;
  do not invent a connected AgentView or a successful send response.
- Browser geometry and animation checks prove only browser behavior. Keep native
  resize/focus and actual agent/model verification as separate evidence.
- Compare paw bounds relative to the frame outer bounds across all four modes
  and the settings surface; equal CSS literals alone do not prove equal rendered
  placement. Disable entrance motion or wait for it to settle before measuring.
  Inspect the corner-overlap screenshot and check title clearance/clipping.
- Compare same-scale screenshots of the entire top-left corner, including the
  arc/background under the badge. Identical badge bounds do not establish
  identical placement relative to different 20/28/72px corner shapes. Include
  short headers and painted child backgrounds in this comparison.
- Also inspect the legal empty-body/no-footer case: a tall QA specimen can hide
  radius normalization of a short frame. New clipping must not conceal existing
  compact error or footer controls; check the header/body/footer height budget.
- Tail configuration checks must inspect the SVG path bounds as well as its
  viewport. Include width-only100px with default compact30px height and confirm
  the path still overlaps the frame edge; test explicit right0 and mode changes.
- For tail visual acceptance, inspect the frame/tail seam on both settings and
  chat surfaces. Check painted outline endpoints, stroke weight/color and shadow
  continuity; changing its position alone does not resolve a pasted-on shape.
- When porting a supplied HTML reference, inventory its decorative elements as
  well as the outer path. Verify footprint silhouette, count, scale and visible
  placement; a print outside the native window or concealed by the composer does
  not satisfy visual completeness. Keep the preserved corner badge separate.

## Native window timing evidence

- The optional local diagnostic remains disabled in a normal production frontend. Use the user's authorized data scope, retain ordinary artifacts, and restore them after the check; diagnostic results are separate from ordinary-app acceptance.
- For a passive CUA transition check, use a unique `phase-v5` request with `mode:normal`, `action:none` and `armOnNextTransition:true`. Both WebViews must report the same protocol and acknowledge the mode. The diagnostic must not perform the UI action.
- Armed collection waits up to 30 seconds for this WebView's real `route:change-enter`, records its exact `rafSeedNow` and captures for 1500 ms. Native timeout is 35 seconds. Replacement detection polls the existing local request every 250 ms; do not describe it as instantaneous cancellation. Timeout, cancellation, unload and late reports must release their timer/RAF/armed callback and remain isolated by request ID.
- Classify only a matching PID/request/window report. Check that actual transition marks fall within its capture and distinguish natural `morph-end` from watchdog or cancellation. A native arming status is dispatch intent, not proof that the frontend armed or captured a transition.
- Exclude the first seed-to-callback partial interval from complete-interval statistics. N callbacks provide at most N−1 complete callback intervals. A late route file retaining the same ID is not evidence that sampling continued.
- WebView callback intervals, passing tests and successful builds do not establish compositor FPS or release readiness. Zero callbacks do not establish that the app failed to render. Record the exact observed scope and missing evidence.

## Code Review Checklist

- [ ] `pnpm build` 通过（类型零错误）
- [ ] 新增 effect 有 cleanup；timer 用 `window.setTimeout` 且 id 存 ref
- [ ] 新增 Tauri command 在 `src/lib/agent.ts` 有类型化包装
- [ ] UI 无 emoji、无英文文案、图标有 `aria-hidden`
- [ ] 无假数据路径：失败走错误提示
- [ ] 改了 `public/pets/` 资源 → 跑过 `pnpm pet2d:validate`
- [ ] 跨窗口状态变更 → 确认另一个窗口的 listen 端同步更新
