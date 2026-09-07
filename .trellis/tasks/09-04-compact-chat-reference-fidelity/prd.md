# 紧凑聊天面板对齐参考设计图

## Goal

当前 attached compact 聊天面板视觉效果与参考设计图差距大，需要对齐。
参考图（用户提供的截图）：奶油色圆角气泡面板贴在白猫左侧，包含——

- 面板整体：奶白/米色渐变底、大圆角（约 28px）、柔和投影、右侧朝猫的尾巴
- 左上：橙色猫爪徽章（圆形奶油底、凸起、略微超出面板边缘）
- 标题区：深色粗体「想聊点什么？」+ 灰色副标题「我随时都在，陪你聊天、解答问题、生成内容~」
- 右上三个图标按钮：设置（滑杆）、图钉、关闭 X（浅灰圆形）
- 输入区：白色胶囊输入框（奶油色描边），左侧橙色四角星，右侧回形针、麦克风图标，
  最右是实心橙色圆形发送按钮（白色纸飞机）
- 底部四个快捷提问 chip：胶囊形，各自配色——
  帮我分析（黄/灯泡）、生成文档（蓝/文档）、数据分析（绿/图表）、创意灵感（紫/火花）

## Requirements

- 只改 `src/styles.css` 的样式为主，必要时微调 `ChatPanel.tsx` 结构；不改交互逻辑
- 遵守 `.trellis/spec/frontend/` 已沉淀的约定（无 emoji、lucide 图标、中文文案、
  全局单一样式表、is-* 状态类）
- compact（attached）模式是本次重点；expanded 模式不能因此破版
- 参考图放置在 `.trellis/tasks/09-04-compact-chat-reference-fidelity/reference.png`

## Acceptance Criteria

- [x] `qa/chat-preview.html` 紧凑模式截图与参考图并排对比：面板、徽章、标题区、
      输入胶囊、四个 chip 视觉一致（允许合理误差）
- [x] expanded 模式截图不破版
- [x] `pnpm build` 通过

## Notes

- 参考图源：`/var/folders/ys/cjf2rbtd03lg_fclhtmcmgn80000gn/T/clipboard-2026-09-04-093205-382EBDE0.png`
- 预览页 `qa/chat-preview.tsx` 的 `PetStage` 调用缺少新增必填 props
  （`mode`、`onContextMenu`），需要顺手修一下才能跑起预览
