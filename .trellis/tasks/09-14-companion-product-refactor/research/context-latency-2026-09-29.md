# Context cost investigation — 2026-09-29

## Scope and evidence

Read-only inspection of current source and four existing real model-call captures.
No new model call, replacement service, mock conversation, database write, or
product-code change was made. Queries used read-only transactions and a five-second
statement timeout. Only aggregate counts were printed; historical content and
credentials were not printed.

## Findings

`server/app/runtime_store.py:454–469` caps history at forty nonempty messages,
not at a token or character budget. It separately preserves tool facts from
failed/interrupted runs. `server/app/agent_service.py:334–345` always binds the
registered tools and includes all plugin prompt fragments for the model call.
For these requests that means nine tool schemas. All four requests actually
executed zero tools: declaring tools and executing them are separate costs.

| Run suffix | History characters | Last ten history messages, characters | System characters | Provider input tokens |
| --- | ---: | ---: | ---: | ---: |
| adde8f | 5,631 | 4,975 | 2,373 | 6,524 |
| 61ef51 | 5,768 | 4,393 | 2,373 | 6,674 |
| e2c252 | 6,842 | 5,441 | 2,373 | 7,425 |
| 8ddb94 | 8,907 | 7,134 | 2,373 | 8,920 |

The last 24-character question includes 8,907 characters of historical content.
Its most recent ten history messages already contain about 80% of that history
text. Simply changing forty messages to ten would therefore remove only about
20% of history characters in this case, while leaving system/tool content.
Character reductions are not token or latency reductions. A message-count-only
change is not an adequate context-budget design.

The four captured system messages share a 2,152-character prefix. Current and
request-acceptance timestamps are appended to the static rules, before history
(`agent_service.py:68–84`). They must remain accurate for relative reminders.
Moving dynamic context later could preserve a longer stable request prefix,
but cache effects depend on the provider/proxy and are not demonstrated here.
The last provider usage reports 1,792 cached tokens; it is incorrect to say that
all input caching is disabled. No precise per-component token split is available.

## Timing boundaries

The first-visible-text timer is set before per-delta persistence. Consequently,
per-delta database and Redis work does not explain the last request's first-text
wait of 9.473 seconds. Later stream chunks do await persistence and notification;
their overhead is not separately measured.

The native control connection checks durable events on a 250 ms polling cadence
(`server/app/main.py:275–313`). This is a separate delivery boundary; it is not a
measurement of actual native paint delay and cannot explain the provider-side
9.473-second interval by itself.

## Smallest useful optimization design

1. First address task wakeup and competing read locks, after a targeted regression
   test establishes the intended scheduling and event-ordering contract. See the
   backend latency report for the candidate one-second path.
2. Design a token budget for context with preserved recent turns, unresolved tool
   facts, and explicit memory/summarization behavior. Do not silently discard
   durable history or break short follow-ups such as “可以”.
3. Review plugin instruction/schema inclusion without a keyword-only classifier
   that would hide a needed capability. An extra model-routing call can itself
   add latency; no such call is recommended without comparison.
4. Compare the same saved real context/model before claiming a speedup. The four
   existing requests differ in input, output length, caching and service timing;
   they are not a controlled benchmark of context size.

These are investigation findings and proposed changes, not implemented or
runtime-validated optimizations.
