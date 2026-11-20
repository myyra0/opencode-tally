# Tally Report Reference

This reference explains where each part of a Tally report comes from and how much confidence to place in it. Start with the [README](../README.md) for installation and normal usage.

## The Three Number Classes

| Class | Source | Use it for | Do not treat it as |
| --- | --- | --- | --- |
| Recorded usage | Usage OpenCode recorded on assistant messages, one per completed provider step | Recoverable provider usage, steps, and OpenCode-recorded cost | A provider invoice or full session-lifetime history |
| Retained content | Local tokenization of exposed session text and replayable tool output | Finding large retained contributors | Billable usage or an exact active-context snapshot |
| Explanatory estimates | Tokenizers, pricing metadata, and bounded heuristics | Understanding likely cost, cache, schema, and catalog effects | Recorded telemetry |

The formatter keeps these classes in separate sections and labels estimates explicitly.

## Report Sections

### Warnings

Warnings appear first when Tally has to qualify the rest of the report. Common causes include:

- model-specific tokenization was unavailable and an approximate tokenizer was used;
- live provider pricing was unavailable and bundled pricing was used;
- tool, skill, provider, export, or child-session metadata could not be loaded;
- the recorded session aggregate disagrees with the usage summed from assistant messages;
- a revert or compaction boundary limits what can be reconstructed.

A warning does not necessarily invalidate the whole report. It identifies the affected source or estimate.

### Token Breakdown by Category

This is a locally tokenized inventory of content still exposed through the session data:

- system-role messages and exposed system overrides;
- user and assistant text;
- reasoning text when OpenCode exposes it;
- replayable completed tool results, including persisted tool errors.

It excludes generated OpenCode system prompts, provider framing, tool-call arguments, and media. Those inputs are not reconstructed and silently added to the local total.

The category charts, tool-usage breakdown, and top contributors all describe this retained inventory. They are useful for locating large content, but they do not explain the provider's billable input by themselves.

### Most Recent Recorded Provider Step

This section shows the raw usage buckets from the most recent provider step: fresh input, cache read/write, output, reasoning, provider total, and recorded cost. OpenCode records that usage on the assistant message for the step, so the values come straight from the session.

The provider step that invokes Tally is absent because OpenCode persists it only after the tool returns.

### Recorded Usage Snapshot

OpenCode records usage on assistant messages, one message per completed provider step. Tally aggregates the usage on every assistant message that carries it, including multi-step assistant turns and tool loops, rather than counting only the last step of a turn.

Assistant messages with no recorded usage are counted structurally but add neither a step nor usage buckets.

The displayed total uses non-overlapping buckets:

```text
fresh input + cache read + cache write + output + reasoning
```

Structural assistant-message count is shown separately from completed provider-step count.

### OpenCode-Recorded Cost

When OpenCode stored a nonzero session cost, that value is the report's primary cost basis. Tally also explains usage with per-model public API pricing resolved from live OpenCode metadata or the bundled catalog.

When recorded cost is zero, the report uses a visibly labeled API-rate estimate instead. Neither value is presented as a provider invoice. Cache prices and context-price tiers are applied per provider step before aggregation.

### Context Breakdown

When exported prompt fragments and live tool metadata are available, Tally reports the components it can identify directly. When generated prompt content is unavailable, it uses the first recorded `cache_write` as a bounded allocation budget and estimates only:

- tool definitions;
- environment context;
- other unattributed cached prompt content, which can include the base prompt, custom instructions, catalogs, and provider framing.

Estimated components are bounded so they cannot invent more cached context than the observed anchor. The first cache write is a reference point, not proof of the next request's active context and not a precise system-prompt measurement.

### Available Skills and Subagents

These sections estimate the catalog and tool-description content associated with skills and Task subagents. They are always-available context estimates, not recorded provider usage.

Catalog totals are reported separately from loaded skill results so the same content is not presented as both recorded and estimated usage.

### Loaded Skills

Every persisted completed `skill` result is tokenized separately. Repeated calls accumulate their actual retained result sizes rather than multiplying the first result by a call count.

For example, three persisted results of 450, 500, and 550 tokens contribute an estimated 1,500 retained tokens. Full session compaction or a revert can still change what remains in active context.

### Tool Definition Costs

When OpenCode exposes live tool metadata, Tally tokenizes those definitions directly. When it does not, Tally falls back to a visible estimate based on observed calls:

- argument count approximates schema breadth;
- arrays and objects mark a tool as structurally complex;
- the resulting token count is labeled as an estimate.

Tool-call arguments remain excluded from the retained-content total; they inform only this schema-size fallback.

### Cache Efficiency

Cache efficiency compares cache reads with fresh input and cache writes. It reports:

- cache hit rate;
- estimated cost with and without caching;
- estimated savings;
- effective blended input rate.

These cost comparisons use model pricing, so a pricing warning also qualifies the cache-cost estimates.

### Subagent Costs

When enabled, child sessions are traversed recursively with cycle and duplicate protection. The report shows each child's tokens, cost, and completed provider steps, then combines them with the main session in the summary.

The optional detailed breakdown expands each child into fresh input, cache read/write, output, reasoning, and estimated cost buckets. A nonzero OpenCode-recorded child cost remains the displayed child total even when the estimated bucket split does not sum exactly to it.

### Summary

The summary combines main-session and included subagent totals. Its cost basis is stated directly:

- OpenCode-recorded cost where nonzero;
- otherwise a labeled public API-rate estimate.

## Reconstruction Limits

Tally reports what the OpenCode session APIs still expose. It cannot reconstruct:

- the provider step currently invoking Tally;
- later report-reading and final-response steps;
- deleted or reverted-away history as lifetime spend;
- generated provider framing or unexposed system prompts;
- an exact post-compaction request from retained transcript content alone.

Use recorded telemetry for recoverable usage, retained-content estimates for contributor analysis, and explanatory estimates for diagnosis—not as interchangeable totals.
