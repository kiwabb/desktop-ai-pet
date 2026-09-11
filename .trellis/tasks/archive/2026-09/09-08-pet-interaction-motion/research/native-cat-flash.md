# Onscreen cat flash — native A/B investigation

User made pet desktop visible. Screen capture inventory: window28809,232×381 at1218,545. Recorded `/tmp/pet-open-baseline.mov` with system screencapture region510,166,940,760 while CUA clicked pet. Recording includes real background; keep raw video in temp, do not publish unrelated desktop contents.

Original video frame202 at6.053333s shows entire cat/status/platform absent; frame203 at6.070000s restores them. Bubble appears afterward. Contact `/tmp/pet-open-actual-critical.png` contains source frames198–209, cropped to pet region. 4fps/30fps sampled contacts missed the transient; inspect source timestamps without frame-rate resampling. Pixel change ranking of a cat-core crop identified the pair (mean channel delta23.79 and23.85 versus next1.18). This demonstrates real whole-window dropout and rejects CSS-only explanation.

A/B1: change only native setFrame display:false→true, preserving focus/order and CSS. Compare same source-frame metric and real screenshots before choosing final repair. Viewport and build success remain weaker evidence.


A/B1 result: first opened capture `/tmp/pet-open-display-true.mov` had no observed absent-cat frame (largest core delta4.51). However60s `/tmp/pet-display-true-cycles.mov` recorded10 real settings/back cycles and4 close/open cycles. Source frame2261 at45.686667 through2263 shows cat absent, restored2264 at45.728333. Many other dropout pairs detected (core delta144). `/tmp/pet-cycles-critical.png` visually confirms missing cat. Thus A/B1 FAILED repeatability; do not keep it as a proven fix. Single first-open pass was insufficient.

A/B2 restores display:false and removes only redundant macOS post-resize show_and_make_key on the already-visible main panel. Preserve all CSS and nonmac focus. Pending comparable recording. Do not infer unique cause from current evidence.

A/B2 also FAILED: `/tmp/pet-no-refocus-cycles.mov` shows source frames1177–1180 absent and1181 restored (20.608333→20.675000), and other repeated dropouts across3 settings cycles. `/tmp/pet-no-refocus-critical.png` inspected. Neither display policy nor redundant focus alone fixes whole-cat disappearance. Stop flag tuning.

Evidence-driven implementation correction: keep main cat NSPanel fixed and move integrated chat surface into the existing chat WebView. Removes chat-driven resizing of cat's backing. This is an internal implementation change for the existing accepted visual/interaction goals, not a new visual feature. Native ordering, synchronized dragging and state acknowledgements need verification. No assertion yet that all flash is removed.


Fixed main + child chat trial: native inventory kept main at232×381+1218+545 in closed/compact/expanded modes. Real60s capture `/tmp/pet-fixed-windows.mov` covered initial open and10 settings/back cycles; typed unsent draft retained. Contact `/tmp/pet-fixed-critical.png` revealed chat dock rendered above cat, so this trial did not pass visual acceptance. Root added main.order_front_regardless after chat.show_and_make_key, preserving keyboard focus. Rebuilt debug bundle successfully.

Second trial `/tmp/pet-fixed-order.mov` (45s,2561 original frames) covered initial open,2 settings/back cycles and3 close/reopens. Native textarea focus/draft preservation passed and test draft was cleared without submitting. Cat remains visible in inspected high-delta source frames and dock is behind it. However `/tmp/pet-order-critical.png` exposes old settings content across the cat region while native chat shrinks; this is a real remaining visual failure, not successful smoothness. All-frame core change ranking max5.324 at frame1159; that number alone does not prove no flicker.

User manual drag acceptance FAILED: cat and chat did not move together; title bar did not move. Therefore parent-child linkage/main.start_dragging from a child event is not a verified drag solution. Implementation agent tasked with both drag repair and visible native resize artifacts. Task remains in progress.


User screenshot follow-up confirms dock above cat again in todo expanded view, despite one-time main.order_front_regardless. Actual running final candidate PID23408 window inventory: main30474 layer4, chat30475 layer4. Same-level focus reordering is not a persistent stacking contract. Implemented correction under review: main Floating+1 (5), chat Floating (4), retain chat keyboard capability. Fixed nspanel source supports arbitrary/custom levels; no dependency change is needed for this correction.
