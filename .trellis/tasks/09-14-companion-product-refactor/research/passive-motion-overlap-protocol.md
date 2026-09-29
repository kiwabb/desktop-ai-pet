# Research: Bounded passive sampling across CUA window transitions

- Query: Can at most six sequential existing `mode: normal`, `action: none` requests capture a valid compact/expanded transition overlap while all UI changes remain ordinary CUA actions?
- Scope: internal, bounded read-only source analysis. No instrumentation changes, builds, runtime probes, UI actions, database/model calls or service operations were performed by this researcher.
- Date: 2026-09-15

## Findings

### Decision

**The existing instrument can establish an overlap when its recorded timing satisfies the checks below. Six requests improve temporal coverage but cannot guarantee an overlap.** They are separate nominal one-second sampling windows, with polling/ACK gaps, not one continuous six-second trace. If all six miss the transition or return busy/error results, the accurate outcome is no qualifying overlap captured. Do not turn a later route record into coverage or continue unbounded retries.

A completed sample can prove JS `requestAnimationFrame` callback timing during a marked animation lifecycle. It cannot prove compositor FPS, screen presentation timing, physical display cadence, or absence of visual artifacts.

### Files and source patterns

- `src/lib/motion-diagnostics.ts:5` — protocol `phase-v4`; instrumentation is enabled only for dev or `motion-diagnostic` mode.
- `src/lib/motion-diagnostics.ts:13` — marks carry same-document `performance.now()` and coarse wall-clock epoch; routes continue emitting while `requestId` exists, even when the sample's marks collection has ended.
- `src/lib/motion-diagnostics.ts:50` — report metadata includes source window, reduced-motion preference, epoch, `timeOrigin` and start `now`.
- `src/lib/motion-diagnostics.ts:53` — both apply and run phases reject an already active probe or `[data-frame-morphing=true]` with `transition-or-probe-busy`.
- `src/lib/motion-diagnostics.ts:57` — apply stores the request ID and diagnostic mode. Run sets `busy`, starts a new marks array and records intervals; `action:none` executes no synthetic button click.
- `src/lib/motion-diagnostics.ts:69` — interval zero starts at an unrecorded `performance.now()` seed; subsequent intervals are callback-timestamp differences. At most 240 intervals are retained.
- `src/lib/motion-diagnostics.ts:92` — a nominal 1000 ms timer stops sampling, then reports `completedNow`, marks, intervals and `stillMorphing`. Timer delay can make the real window longer than 1000 ms.
- `src-tauri/src/motion_diagnostics.rs:55` — results/routes must match the native controller's current ID; only the target window's report becomes the result. Routes include their own source-window labels.
- `src-tauri/src/motion_diagnostics.rs:79` — request-file polling interval is 250 ms. New IDs are necessary; identical IDs are ignored.
- `src-tauri/src/motion_diagnostics.rs:103` — both `main` and `chat` must be ready with `phase-v4`.
- `src-tauri/src/motion_diagnostics.rs:113` — apply is dispatched to both windows. Run begins only after both mode ACKs arrive without errors and match the requested mode, within a two-second ACK wait.
- `src-tauri/src/motion_diagnostics.rs:121` — `action:none` always targets **chat**; only `action:open` would target main. The run-report timeout is three seconds.
- `src/components/useFrameMorph.ts:81` — layout-effect/direct-commit marks distinguish a route/state change from an actual animated morph.
- `src/components/useFrameMorph.ts:161` — after paint/font settling, effects start and produce `morph-settled` and `morph-start` marks.
- `src/components/useFrameMorph.ts:202` — animation start; natural completion produces `morph-end`. A 1200 ms watchdog produces `morph-watchdog`; cleanup can also occur after cancellation.
- `src/components/useFrameMorph.ts:222` — two rAF callbacks/font readiness precede start; a 200 ms settle timer bounds the wait.
- `src/App.tsx:360` — `route:change-enter` carries the requested mode and whether it is the chat window.
- `src/App.tsx:450` — compact/expanded open-to-open changes use React mode state, then `route:morph-wait-paint` and `route:morph-hit-bounds`. Those route markers are not animation completion markers.

### Practical plan: one bounded passive request train, CUA owns UI

1. Main confirms the authorized temporary diagnostic build/PID and both `main`/`chat` ready entries with protocol `phase-v4`. Establish the ordinary compact view and obtain the relevant CUA target before starting the train, reducing UI discovery latency during the short samples.
2. Start one bounded asynchronous request producer under the main session's existing authorization. It writes only the existing closed request schema, for example `{"id":"cua-overlap-unique-01","mode":"normal","action":"none"}`. No action other than `none`, no settings changes, arbitrary JS, DOM clicks, or synthetic input belongs in these requests.
3. The producer writes **one request at a time**, waits for a matching terminal result ID, copies that result/metadata into the authorized evidence location before the next result overwrites it, then issues a fresh unique ID. Cap the entire train at **six requests**, including busy/error attempts. Keep a bounded per-request deadline consistent with the native two-second ACK and three-second report waits. A matching native timeout result is an unsuccessful attempt; if the producer's own deadline expires without a matching result, stop the train instead of replacing a still-pending request. Never overwrite a pending request with another ID.
4. Yield control back to the main session while the producer continues waiting/sampling. The main session uses only CUA for one compact→expanded action and, after it has settled, an expanded→compact action if a further direction sample is needed. Do not wait for the entire first one-second report before initiating the first CUA transition; that sequencing caused the earlier missed samples. A current-ID `running-action` status is a useful dispatch cue, but it is not proof that the eventual CUA transition landed before sample completion.
5. Read-only collection proceeds independently while CUA performs the actual transitions. The producer must finish each result before writing the next request. Samples landing during an existing morph may return busy, creating a gap rather than an extending trace. A busy sample counts against the six-request cap; avoid interpreting rapid busy retries as continuous coverage.
6. Stop early once a qualifying sample has been preserved for the required direction(s), or stop after six attempts. Classify missed, busy, partial, watchdog and qualifying samples separately. Restore the ordinary build/startup environment using the previously authorized main-session restoration procedure. This researcher does not perform that runtime work.

This request-train/CUA overlap is a scheduling opportunity, not a guaranteed timestamp alignment. If tool-call latency consumes all available sampling windows, the unchanged instrumentation cannot recover a missed overlap afterward.

### Required identity and readiness checks

- Result ID must match the saved request; protocol must be `phase-v4`, mode `normal`, action `none`, window **chat**, with current PID and expected diagnostic assets/readiness.
- Require a successful completed report with numeric `now`, `completedNow`, `timeOrigin`, and no `error`. A matching route file alone is insufficient.
- Both mode ACKs are enforced by the native code before run dispatch. **Successful ACK payloads are not saved in the success result/status.** A successful report from this inspected implementation proves that the dual-ACK gate passed; it does not provide separately archived ACK payloads. Error `mode-ack-failed` does include the ACK map and is a rejected sample.
- The expected chat-window route should identify the CUA-requested compact/expanded direction. Correlate the main session's actual CUA action with the report's matching chat-window route/marks; do not infer an action from an arbitrary current ID.
- Preserve the report's `reducedMotion`. `mode:normal` does not force reduced motion off: true means the existing reduced-motion, opacity-only path. Do not claim a full-motion sample when it is true or when the preference changed during the attempt.
- `transition-or-probe-busy`, `mode-not-applied`, mode/dispatch errors, missing report and report timeout are not successful timing samples. Probe `busy` concerns instrumentation/morphing; it is not a model/chat-processing status.

### Exact timing/overlap rule and first-interval limitation

Use **only the chat document's monotonic times** for an overlap calculation. Let:

- `B = report.now` (captured before the run guard/setup);
- `Q = marks[request].now`;
- `C = report.completedNow`;
- `d[0..n-1] = rafIntervals`;
- `A = marks[morph-start].now`, `Z = marks[morph-end].now` for the relevant single transition.

Prefer a complete natural transition: matching `morph-created`, `morph-start`, `morph-end` and cleanup within the report, `Q <= A < Z <= C`, `stillMorphing=false`, no watchdog, and no earlier cancellation/second morph that makes pairing ambiguous. `direct-commit` and route markers without `morph-start` do not establish an animation interval. If start exists but natural end is absent or `stillMorphing=true`, preserve it as partial evidence; do not claim normal full-transition completion.

The interval seed `L` assigned by `let ... last = performance.now()` is not emitted. Source order bounds it by **`B <= L <= Q`**. Let `S[k]` be the cumulative sum `d[0]+...+d[k]`. Retained callback timestamp `F[k]` therefore lies in **`[B+S[k], Q+S[k]]`**. This uncertainty must remain explicit; reconstructing exact timestamps from `report.now` alone is not valid.

- `d[0]` is an initial partial interval from the seed to the first callback timestamp, not a full callback-to-callback frame interval. Exclude it from ordinary interval percentile/mean calculations. Retain it only for seed/coverage reconstruction and separately labeled startup delay.
- For a full interval `i >= 1`, its boundaries are `[L+S[i-1], L+S[i]]`. It is guaranteed to have positive overlap with `[A,Z]` if **`Q+S[i-1] < Z` and `B+S[i] > A`**. These are conservative inequalities over every possible seed in `[B,Q]`.
- For an interval guaranteed wholly inside the marked animation, require **`B+S[i-1] >= A` and `Q+S[i] <= Z`**. Only such intervals should be labeled exclusively animation-period intervals; the whole one-second sample also contains idle/preparation/post-animation work.
- Stronger full callback coverage of the animation requires **`Q+S[0] <= A` and `B+S[n-1] >= Z`**, in addition to the complete natural lifecycle above. This proves the retained callback span brackets the animation despite the unrecorded seed; it still does not prove screen presentation.
- Check for finite interval/time values and monotonic retained full intervals before calculation. Zero/one callback or uncertain intersection means no qualifying callback-overlap evidence. At the 240-interval cap, retained timestamps cover only that prefix; `completedNow` cannot extend the captured interval span. Either analyze the retained prefix with these bounds and label the cap, or reject it for full-window statistics.

Route marks and lifecycle marks are capped at 64 per collection. A missing lifecycle marker in a saturated report is unknown, not permission to infer a clean finish from `stillMorphing=false`.

### Route records versus completed samples

`requestId` remains assigned after sample completion while `marks` becomes null. Later route events can therefore keep the old ID and update `/tmp/desktop-ai-pet-motion-route.json`. They demonstrate a route event, **not ongoing rAF sampling**. Routes may also occur after apply but before the run's sample begins. The report's embedded route snapshot is only what native had received when it wrote that report; delivery order is not the rendering timeline.

Use the completed report's same-window `marks` and time bounds for sampling claims. If consulting a route event separately, require its own timestamp to lie inside the relevant window and still require independent morph/callback overlap. Do not combine bare `performance.now()` values from `main` and `chat`; their time origins differ. Epoch/timeOrigin conversion can correlate cross-window events only with stated precision, not replace same-window lifecycle evidence. Native receive time measures IPC/file receipt, not animation time.

### Related specs and external references

- Task PRD R3/R4/R8/R12: actual native motion and performance evidence remains distinct from static code and unit tests.
- Task design validation: use the current source-owned app and preserve honest unavailable/untested states.
- Existing task research distinguishes database stream events from rendered frames; the same evidence discipline applies here.
- External references: none; all conclusions derive from the four current source files above. No dependency/API version assumption is needed.

## Caveats / Not Found

- No sample was collected by this researcher. This file is a source-grounded collection/acceptance protocol, not a performance result.
- The existing instrument has no passive trigger waiting for a future route, no continuous multi-second request, no saved successful ACK pair, and no emitted exact rAF seed. Six sequential requests do not add those capabilities.
- A clean complete transition can be accepted only if the actual retained result meets the stated identity, lifecycle and conservative timestamp-intersection checks. Otherwise report that the bounded attempt did not capture qualifying evidence.
- No compositor FPS, exact display cadence or physical smoothness claim follows from these callback intervals.

## Actual result: phase-v5 armed sample captures watchdog recovery

### Version and evidence boundary

The preceding collection procedure describes the inspected **phase-v4** instrumentation and is retained as historical analysis. This new observation uses **phase-v5**, with `armOnNextTransition` and an explicitly recorded `rafSeedNow`. The earlier v4 statement that the sampler cannot arm for a future transition, the nominal one-second window, and the unknown-seed reconstruction do not apply to this v5 report. This researcher classified the saved result without changing or rerunning instrumentation.

The five inspected files are:

- `output/companion-review/runtime-motion/armed-v5-ac20dffe3135/ready.json`
- `output/companion-review/runtime-motion/armed-v5-ac20dffe3135/request.json`
- `output/companion-review/runtime-motion/armed-v5-ac20dffe3135/result.json`
- `output/companion-review/runtime-motion/armed-v5-ac20dffe3135/status.json`
- `output/companion-review/runtime-motion/armed-v5-ac20dffe3135/route.json`

The main session reports a CUA compact→expanded action after Raise and collector exit code 0. Those are main-session execution observations; this researcher did not perform UI actions, run the collector, issue a new request or inspect a physical frame.

### Identity and actual classification

Readiness, result, status and route files consistently identify **PID 43288**. Both ready windows (`main`, `chat`) report **`phase-v5`** and asset **`/assets/index-CoLNfZcD.js`**. The request, result, status and route records match ID **`armed-6fef0e9047394cf6`**. The request/result specify `mode=normal`, `action=none`, `armOnNextTransition=true`. The result comes from **chat**, with **`reducedMotion=false`** and no error field. The status snapshot says `arming-transition`; that snapshot does not override the later completed result. The five files do not contain separate successful apply-ACK payloads; readiness alone is not an independently observed pair of apply ACKs.

**Classification: a valid armed observation overlapping the expanded route, morph preparation/start, and watchdog cleanup; it is not a successful natural morph or a valid callback-frame-rate measurement.** The report contains **zero retained rAF intervals**, `morph-watchdog` and `morph-cleanup`, with no `morph-end`. `stillMorphing=false` agrees with cleanup having cleared the morph marker before the report; it does not prove that the destination was physically visible then.

### Exact same-window monotonic timeline

All `now` values below are chat-document monotonic milliseconds. The exact recorded sample seed is **116343** and completion is **117844**.

| Event | Recorded `now` | Difference from sample seed |
| --- | --- | --- |
| Armed request metadata | 104962 | Before active sampling |
| `rafSeedNow` | 116343 | 0 ms |
| `request`, `route:change-enter` (`expanded`, `chat=true`) | 116344 | 1 ms |
| `route:morph-wait-paint` | 116346 | 3 ms |
| `layout-effect` | 116391 | 48 ms |
| `morph-created` | 116400 | 57 ms |
| `route:morph-hit-bounds` | 116467 | 124 ms |
| `morph-settled` | 116600 | 257 ms |
| `morph-start` | 116603 | 260 ms |
| `morph-watchdog` | 117804 | 1461 ms |
| `morph-cleanup` | 117805 | 1462 ms |
| `completedNow` | 117844 | 1501 ms |

The observed ordering is `seed <= route < created < settled < start < watchdog < cleanup < completed`. Unlike the missed v4 samples, this proves the relevant route and recovery lifecycle are inside the **actual active sample window**. With no recorded callbacks, it cannot satisfy the earlier callback-interval intersection criteria or provide callback-gap statistics.

Keep these elapsed measurements separate:

- Active sample: **1501 ms**, `completedNow - rafSeedNow`.
- Request marker/route to report: **1500 ms**.
- Armed metadata to active seed: **11381 ms**, waiting before sampling started.
- Armed metadata to report: **12882 ms**, which includes that wait and is **not** the active sample duration.
- Route to morph creation: **56 ms**.
- Creation to settled: **200 ms**; settled to start: **3 ms**.
- Route to animation start: **259 ms**.
- Animation start to watchdog: **1201 ms**.
- Watchdog to cleanup: **1 ms**.
- Route to watchdog: **1460 ms**; route to cleanup: **1461 ms**.
- Creation to cleanup: **1405 ms**.
- Cleanup to report: **39 ms**.

For coarse UTC correlation, the route/request epoch is `2026-09-15T07:15:15.375Z`, completion epoch is `07:15:16.875Z`, and native result receipt is two milliseconds later. Native receipt measures report delivery, not presentation time. The monotonic fields above own the elapsed calculations; their millisecond precision does not establish physical display timing.

### What this establishes and what remains unknown

- The instrument actually observed the requested expanded route during the armed sample and recorded the watchdog recovery path. This is not a late route attached to an already finished sample.
- The 200 ms creation-to-settle interval is consistent with the previously inspected settle-timeout fallback, but the saved mark does not encode which readiness branch invoked `start`. Do not claim the exact branch solely from the duration.
- The 1201 ms start-to-watchdog interval and subsequent cleanup show a watchdog recovery, not natural `Animation.finished` completion. Collector exit 0 means collection succeeded; it does not convert the observed fallback into a clean motion pass.
- `rafIntervals=[]` establishes **no rAF callbacks recorded by this sampler during the 1501 ms active window**. It does not establish zero compositor frames, zero display refresh, or that all callbacks elsewhere in the application stopped.
- The five files do not establish why no callbacks were recorded. Visibility/occlusion, scheduling/throttling, WebView/document timeline behavior and instrumentation context require separate evidence before assigning a cause. Raise is a reported action, not proof of the document's complete visibility/timeline state.
- Physical visibility, the exact instant the user saw the destination, compositing smoothness and FPS remain unmeasured. This result contains no screen-frame sequence or compositor trace.

No source, runtime configuration, service, database, model or UI operation was changed by this classification. The main session owns normal-build restoration and any separately reviewed recovery-timing fix; neither a fix nor its verification is implied by this saved sample.

## Actual result: recovery build records natural completion with callbacks

This bounded classification inspected the five saved `ready`, `request`, `result`, `status` and `route` JSON files under `output/companion-review/runtime-motion/armed-recovery-d524534f1d68/`, plus the previous `armed-v5-ac20dffe3135/result.json`. No source, test, build, UI or runtime operation was performed.

The new files consistently identify **PID 47142**, request **`armed-4022d94b4eff41bf`**, **`phase-v5`**, target **chat**, `mode=normal`, `action=none`, `armOnNextTransition=true`, and `reducedMotion=false`. Both ready windows report asset **`/assets/index-DfZbXaC4.js`**. The result has a matching expanded route, **`morph-end` followed by cleanup**, `stillMorphing=false`, and no watchdog/error marker. This establishes a successful natural-completion observation for this transition. Separate successful apply-ACK payloads are not included in these five files.

| Recorded timing | Previous watchdog sample | New natural-completion sample |
| --- | --- | --- |
| Active sample duration | 1501 ms | 1501 ms |
| Route → cleanup | 1461 ms | **532 ms** |
| Route → animation start | 259 ms | 277 ms |
| Morph creation → settled | 200 ms | 136 ms |
| Animation start → natural end | No natural end recorded | **255 ms** |
| Animation start → watchdog | 1201 ms | No watchdog recorded |
| Retained rAF callback count | 0 | **46** |

The new exact same-window monotonic values are seed/route **52538**, morph-created **52675**, settled **52811**, start **52815**, natural end/cleanup **53070**, and completed **54039** milliseconds. Floating-point representation tails in the JSON were rounded at microsecond precision for subtraction; the displayed differences are exact at the report's millisecond resolution. The entire natural lifecycle lies within the armed sample. Creation→cleanup is **395 ms** and start→cleanup is **255 ms**.

The callbacks require a separate interpretation from natural lifecycle completion:

- The first retained interval is **149 ms**, an initial seed-to-callback partial interval. The remaining **45** are full callback-to-callback intervals; their maximum is **258 ms**.
- Using the explicit seed plus cumulative intervals reconstructs a **258 ms** interval from **52811→53069**, overlapping **254 ms** of the marked animation interval **52815→53070**. The next **242 ms** interval, **53069→53311**, overlaps its final **1 ms**.
- Retained intervals sum to **1486 ms**, with the last retained callback at **54024**; report completion is 15 ms later. The sample is not capped at 240 callbacks.
- Thus actual callback coverage and natural completion are observed, but this is **not** a smooth-cadence/FPS pass. No compositor rate or physical presentation measurement follows from these JS intervals or the natural-end marker.

The new **no-paint timeout recovery branch was not observed in this capture**. The previous case had zero recorded callbacks and a watchdog; this case had 46 callbacks and natural completion. These are different observed runtime conditions. Their route→cleanup difference is not controlled evidence that the patch fixed the former zero-callback scenario, nor proof of the new fallback's timing. Triggering/observing that specific branch would require separate authorized evidence; no additional probe is performed here.

The main session is restoring ordinary artifacts. This recorded diagnostic result does not assert that restoration, release readiness, physical smoothness or every recovery path has been verified.
