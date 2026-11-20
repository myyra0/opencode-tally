# Reports

Tally has two ways to read a report. Both describe the same session, but they are not the same view:

| | `/tally` panel | `/tally-report` text report |
| --- | --- | --- |
| How to open | Type `/tally` in a session | Type `/tally-report` in a session |
| Where it appears | A panel beside the session (full screen on a narrow terminal) | Printed into the session as text |
| Model request | None — it reads the analysis directly over the plugin's internal channel | Yes — a model turn writes the text out |
| Adds to the session being measured | Nothing | The report-printing turn itself |
| Best for | Browsing with bars, percentages, and a last-request breakdown | Copying, searching, or keeping the text |

The panel reloads when the session finishes a turn. Press `r` to reload it yourself, `f` for full screen, `esc` to close, and the arrow or page keys to scroll. The same command is in the command palette as **Token usage report**. See [Getting started](getting-started.md) for the first-time steps.

## What the numbers mean

- **Header** — the model name, the number of completed provider steps, and the tokenizer used to count text. A tokenizer is the tool that turns text into token counts.
- **Cost** — OpenCode's recorded cost when it has one. Otherwise it is a labeled API-rate estimate. The panel adds `(estimate)` to the total, or `(partly estimated)` when part of the total is estimated; the text report uses the headings `ESTIMATED API-RATE COST` and an `ESTIMATED TOTAL` line, or `OPENCODE-RECORDED COST` when OpenCode supplied a cost. An estimate uses public prices; it is not a bill. Bundled pricing is a fallback snapshot, and live OpenCode model metadata takes precedence when available.
- **Token total** — the sum of the recorded usage buckets: fresh input + cache read + cache write + output + reasoning.
- **Context** — tokens in the current context window, and the model's limit when it is known. The percentage is how much of that limit is in use.
- **Recorded usage** — the usage OpenCode recorded for completed provider calls, with a **cache hit rate** line showing the share of input tokens served from cache and the estimated savings.
- **Last request** (panel) — the recorded buckets for the most recent completed provider call.
- **Always-sent context** (panel) — the system prompt and tool definitions sent with every request. It is marked **measured from the latest request** when Tally captured a request, or estimated from the first cache write when it did not.
- **Tool output** and **Top contributors** — the largest retained tool results and content items in the local inventory. They help find large content; they are not billable usage.
- **Subagents** — child sessions started by the main session, when they are present.
- **Quota** — subscription limits, when you have connected a subscription.

For section-by-section detail on sources and confidence, see the [report reference](report-reference.md). For a plain-language walk through the common numbers, see [Understand the numbers](guides/understand-the-numbers.md).

## The context window section

Providers report one context count per request, not what filled it. The split by source — system prompt, tool definitions, user text, tool output, assistant, reasoning — comes from local tokenization, which can drift from the provider's count.

- When the local split is close to the count OpenCode recorded, the panel scales it so the parts add up to that count and notes the scale, for example `recorded total, local split scaled ×0.99`.
- When the two are too far apart, the section is labeled **local estimate** and the rows are left unscaled.

This is one reason a number in the panel can differ from the same line in the text report: the panel scales the local split to recorded usage, while the text report prints the local estimates as they are. Both label what they are showing.

## The quota section

The panel shows a **Quota** section; the text report shows a **QUOTAS** section. Each enabled subscription appears with its windows (for example `5h`, `weekly`, or a remaining balance). A block may be marked:

- **` (stale)`** in both views — last good numbers, older than twice the quota refresh interval.
- **` cached`** in the panel, or **`(cached)`** after the provider name in the text report — the latest fetch failed, so earlier numbers are shown alongside an error line.
- **`loading...`** in the panel, or **`(loading)`** in the text report — the first fetch is still in progress.

The failure line is `! <message>` in the panel and `Error: <message>` in the text report.

Visibility of failures differs by surface. In the panel, the `! <message>` line appears only when `quota.showErrors` is `true`, and a provider with missing credentials and no earlier data is hidden even then. The text report shows an `Error: <message>` line for such a provider and hides it only when `showErrors` is `false`. See [Subscriptions](subscriptions.md) to connect one and [The sidebar](sidebar.md) for the compact view.

## Subagents

When subagent analysis is on, child sessions are included. The panel's **Subagents** section lists each child by agent name with its cost, tokens, and completed steps, then a **Session + subagents** total. The text report has a **Subagent costs** section and folds the child totals into its summary.

A child's cost is OpenCode's recorded child cost when that is nonzero; otherwise it is an API-rate estimate. The panel marks the combined total `(partly estimated)` when it mixes recorded and estimated amounts. The text report's SUMMARY instead states `Cost basis: OpenCode-recorded where nonzero; otherwise estimated API-rate cost.`

## The snapshot boundary

A report is a snapshot, not a live feed or a lifetime ledger:

- It describes what the OpenCode session APIs still expose when the report is built. The provider step that invokes Tally is not included, because OpenCode persists it only after the report tool returns; later report-reading and final-response steps are absent too.
- Quota numbers are a separate snapshot, captured at the last quota refresh (every 60 seconds by default). Reset countdowns are measured from that capture time.
- Deleted or reverted-away history, generated provider framing, and an exact post-compaction request cannot be reconstructed from retained transcript content.

A warning line tells you when something qualifies the report. See [Reconstruction limits](report-reference.md#reconstruction-limits) for the full list.

## Related

- [Understand the numbers](guides/understand-the-numbers.md)
- [Report reference](report-reference.md)
