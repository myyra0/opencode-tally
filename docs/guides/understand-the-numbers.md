# Understand the numbers

This guide explains the numbers you see in the Tally sidebar, the `/tally` panel, and the `/tally-report` text report. It does not explain how they are calculated — for that, see the [report reference](../report-reference.md).

A **token** is a small piece of text a model reads or writes; usage and limits are counted in tokens. A **context window** is the maximum number of tokens a model can consider in one request.

## Tokens and cost are different things

Tokens measure text. Cost is money, derived from token counts and prices:

- The **token total** adds the recorded buckets: fresh input + cache read + cache write + output + reasoning.
- The cost line uses OpenCode's recorded cost when it has one: `cost` in the sidebar and `OPENCODE-RECORDED COST` in the text report.
- If OpenCode did not record a cost, Tally uses public API prices and labels them by surface: `cost est` in the sidebar, `(estimate)` in the panel (or `(partly estimated)` when part of a combined total is estimated), and `ESTIMATED API-RATE COST` plus an `ESTIMATED TOTAL` line in the text report.

An estimate is a way to understand likely spend, not an invoice. Prices can be live OpenCode metadata or a bundled catalog; if live prices were unavailable, a warning says so.

## Recorded versus estimated

Numbers fall into three broad groups. Keeping them separate is the key to reading a report:

- **Recorded usage** — token buckets and costs OpenCode saved for completed provider calls. Use this for recoverable usage and call counts. The panel's **Last request** and **Recorded usage** sections use these.
- **Retained content** — a local token count of text still exposed in the session, such as tool results. Use it to find large contributors, not as billable usage. The **Context window**, **Tool output**, and **Top contributors** sections are this kind of number.
- **Explanatory estimates** — labeled guesses such as cost at public rates, tool-definition sizes, and savings from caching. Use them to understand effects, not as telemetry.

The report reference calls these the [three number classes](../report-reference.md#the-three-number-classes) and shows which confidence to place in each.

## Cache hit rate

A **cache read** is text the provider reuses from an earlier request because it did not change; reused tokens cost less than fresh ones. The **cache hit rate** is the share of input tokens served from cache rather than read fresh:

```text
cache read / (cache read + fresh input)
```

A high rate means most input text was reused. The same line also shows estimated money saved, and the text report compares cost with and without caching. Those money figures use model prices, so a pricing warning also qualifies them.

## Context percentage

The **Context** row compares tokens in the current context window with the model's limit:

```text
tokens in context / model context limit
```

It answers "how full is the model's window?", not "how much did this session cost?" Your conversation, instructions, and tool output all share that window. If the model's limit is not known, Tally shows a plain token count and no percentage.

## Panel versus report

The panel and the text report start from the same analysis but present it differently:

- The `/tally` panel is native and makes **no model request**. It adds bars and percentages, a context section scaled to the recorded count, a last-request breakdown, always-sent context, tool output, top contributors, and subagents. It reloads when the session finishes a turn, or when you press `r`.
- The `/tally-report` command uses a **model turn** to print the full text into the session, so it is useful for copying or searching. The text prints local estimates as they are and includes extra sections such as token breakdown by category, tool usage, context breakdown, cache efficiency, and a summary.

The most common surprise is the **Context window** section. Providers report one context count per request, not its ingredients, so the split by source comes from local tokenization:

- When the local split is close to the count OpenCode recorded, the panel multiplies it by a scale so the parts add up, and notes the scale, for example `×0.99`.
- When the two are too far apart, it stays an unscaled **local estimate**.
- The text report prints the unscaled local estimates either way.

That is why the same line can legitimately differ between the two views. See [Reports](../reports.md#the-context-window-section) for more.

## What a snapshot means

A snapshot is a frozen picture taken at one moment, not a live total or a lifetime ledger.

- A **report snapshot** is built from what the OpenCode session APIs still expose at that moment. It includes completed provider steps, but not the step that invokes Tally (persisted only after the report tool returns) or later report-reading steps. Deleted or reverted history and exact post-compaction requests cannot be reconstructed.
- A **quota snapshot** is captured at the last quota refresh, every 60 seconds by default. Reset countdowns are measured from that capture time. Numbers marked ` (stale)` or ` cached` are earlier snapshots kept because a newer fetch failed or has not happened yet.

Warnings list anything that qualifies a report, such as an approximate tokenizer or missing metadata. For the full list of limits, see [Reconstruction limits](../report-reference.md#reconstruction-limits).

## Related

- [Reports](../reports.md) — the two views and their sections
- [The sidebar](../sidebar.md) — the compact version of the same numbers
- [Report reference](../report-reference.md) — section-by-section sources and confidence
