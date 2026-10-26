# 前端全面优化：更像桌宠产品

## 目标与 Delight 论点

**论点**：用户应该感到"桌面上住着一只活的猫"，而不是挂着的一个工具图标——它会呼吸、会困、会因被点击而开心、会在提醒时主动叫人。

产品约束（PRODUCT.md binding）：白猫合成原图是固定资产不可替换；不重绘主体。因此所有"生命感"通过**容器级动效 + 覆盖层装饰 + 文案口吻**实现，不启用 animated 渲染器模式。

模式归属：Operate 为主（面板是工具）， delight 集中在陪伴时刻——待机、互动、提醒唤起、等待。

## 现状关键事实（调研锚点）

- 线上 `mode="reference-closed"`（App.tsx:650）：猫除眨眼外完全静止；心形/星星装饰、呼吸/摇摆动画全部锁在不可达的 animated 模式（PetStage.tsx:107-118,155-158；styles.css:104-166）。
- 眨眼调度器已完善（PetExpression.tsx，可见性/reduced-motion 感知），可直接复用。
- 待机随机剧本已存在（App.tsx:246-264：curious 1.8s 72% / sleeping 3.2s 28%），但线上不可见。
- 回复气泡通道是死代码（App.tsx:647 恒传 reply=null；styles.css:79-102）。
- 状态气泡 PetLiveStatus 常驻，文案是系统状态栏语言（pet-live-status.ts:16-45）。
- 提醒唤起只默默展开面板（App.tsx:276-308），猫无任何反应。
- 点击猫只有线上不可见的 happy 状态（App.tsx:572-576），无 hover 反馈（desktop-shell.css:38-72）。
- 快捷提问是功能名「记录待办/安排提醒/梳理想法/整理文档」（ChatComposer.tsx:104-109）。
- 流式等待只有 spinner+"橘伴正在思考…"（ConversationFeed.tsx:52），无打字指示。
- reduced-motion 处理完整（styles.css:378-381 + design-tokens.css:102-109），新动效必须同等接入。
- 无声音——本任务也不引入（无同意不播放）。

## 范围

### A. 猫的生命力（覆盖层 + 容器动效）
- A1 呼吸：宠物容器 4–5s 微缩放/起伏循环（幅度 ≤1.5%，transform-only），idle 时常驻。
- A2 状态姿态：thinking=轻微歪头（rotate ≤2deg）+ 思考泡（"…"三点起落）；talking=轻微点动；happy=小跳 + 爱心爆发；curious=星星闪烁；sleeping=ZZZ 泡泡升飘。装饰 SVG 复用 PetStage 现有 hearts/stars（从 animated-only 解绑到状态驱动）。
- A3 待机可见化：现有随机剧本落地为 sleeping→ZZZ、curious→星星。
- A4 深夜节律（23:00–06:00）：idle 剧本 sleeping 概率反转为主（如 70%），清醒状态副标题可变"夜深了"。

### B. 互动反馈
- B1 点击猫：happy 小跳 + 爱心爆发可见（现有 700ms happy 状态驱动覆盖层）。
- B2 hover 蹭动：pointer 悬停时轻微 rotate（≤1.5deg）+ 状态卡不变化；不与拖动冲突（拖动中禁用）。
- B3 提醒唤起：面板自动展开时猫小跳 + 短暂说话泡（"时间到啦，来看看～"之类，3–4s 自动消失）——复活/简化 reply 气泡通道为"宠物说话泡"覆盖层。

### C. 文案宠物口吻
- C1 PetLiveStatus 副标题全部改为猫口吻第一人称（如 在线→"我在呢，随时可以聊"；思考中→"让我想想……"；未配置→"还没连上助手，带我去设置看看"）。
- C2 快捷提问改引导语（如"帮我记件事"、"提醒我别忘"、"陪我理理思路"），行为不变（填入输入框）。
- C3 工具卡/提醒卡标题宠物化（如"到提醒时间了"→"橘伴来叫你啦"；回顾卡"橘伴喊你回顾啦"）。

### D. 面板等待时刻
- D1 pending 时 spinner + 文案改为三点打字指示（橘伴正在想…），reduced-motion 下静态三点。

### E. 文档
- E1 DESIGN.md 增加"生命感动效"小节（呼吸/姿态/装饰层规约、reduced-motion 降级、宠物口吻文案规则）。

## 范围外

- 不替换/重绘猫主体资产；不启用 animated/2D 渲染器模式。
- 不引入声音、haptic。
- 不做夜晚主题换肤（仅作息节律）。
- 不改 todo/memo 功能逻辑与数据契约。
- admin 不动。

## 验收标准

- AC1：`pnpm exec tsc --noEmit`、`pnpm test`、`pnpm build` 全绿。
- AC2：qa/pet-preview 可逐状态截图验证：idle 呼吸、sleeping ZZZ、happy 爱心、thinking 思考泡、curious 星星。
- AC3：reduced-motion 下所有新动效静止（眨眼调度已有先例，新模式同等接入 token 体系）。
- AC4：文案全量过一遍：状态卡、快捷提问、提醒卡、等待态无系统运维语言。
- AC5：拖动、点击、右键等现有交互不回归（usePetGroupDrag 协议不受影响）。

## 风险

- 覆盖层定位依赖插画几何（状态卡区域是预留的）——新装饰必须定位在猫体周围空白区，不遮挡脸部。
- 容器动效不能影响 usePetGroupDrag 的测量与 move_pet_group（transform 加在内部包裹层，不加在拖拽定位层）。
- DESIGN.md 动效规约：指数缓出、无回弹——小跳类动效用 translateY 快起慢落（仍 ease-out，不用 overshoot）。
