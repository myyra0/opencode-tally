# The Tally sidebar

Tally keeps a small **Tally** block in OpenCode's sidebar. It is always on: it appears whenever the host sidebar is visible and a session is open. You do not need to run a command to see it. You can turn it off in [Settings](settings.md#sidebar-settings).

A **token** is a small piece of text a model reads or writes; usage and limits are counted in tokens. A **context window** is the maximum number of tokens a model can consider in one request. A **cache read** is text the provider reuses from an earlier request because it did not change. A **quota window** is a limit a subscription applies over time or as a balance. See the [glossary](README.md#words-you-will-see) for these in one place.

## What you see, top to bottom

By default the block shows four sections, in this order:

1. **Quota** — your subscriptions and their limits, once you have connected one.
2. **Context** — tokens in the current context window against the model's limit.
3. **Recorded usage** — input, cache read, cache write, output, and reasoning tokens that OpenCode recorded, plus a cost and cache hit rate.
4. **Context window** — the tokens in your conversation, instructions, and tool output, split by source.

Below the sections you may see a warnings count and an **Updated** time.

Here is a simplified sketch. The numbers are examples, and some rows only appear once there is data for them:

```text
Tally
Quota
  OpenCode GO
    rolling   [████░░░░] 45%  25m
    weekly    [██░░░░░░] 18%  3d
Context
  Tokens      [████░░░░] 42.3K / 200K
Recorded usage
  input        [██░░░░░░] 12.4K   12%
  cache read   [████████] 88.1K   88%
  total        104K tokens
  cost         $0.42
  cache hit    87.6% · saved $0.31
Context window
  System prompt   5.6K   15%
  Tool output     25.6K  71%
  total           35.8K tokens
! 2 warnings
Updated 14:32
```

The same information, in more detail, is in the `/tally` panel — see [Reports](reports.md). A field-by-field tour is in [Read the sidebar](guides/read-the-sidebar.md).

## Reading each part

### Quota

Each enabled subscription becomes a named block with one row per quota window. A row shows the window label (for example `5h`, `weekly`, `monthly`, or a currency), a bar and percentage when the provider reports one, and a countdown to the next reset when the provider reports a reset time. A balance such as `$12.40 remaining` has no percentage, because there is no total to measure it against.

Row titles carry state markers:

- **` (stale)`** — the numbers are still the last good ones, but they are older than twice the quota refresh interval (about two minutes at the default of 60 seconds). Wait for the next refresh; if it stays stale, check the connection.
- **` cached`** — the latest fetch failed, so Tally is showing the last successful numbers together with a `! <message>` error line (`Error: <message>` in the text report). Fix the problem named in the error, then wait for the next refresh.
- **`loading...`** — the first fetch is still in progress.

If a provider is missing entirely, see [What to do when a provider is missing](#what-to-do-when-a-provider-is-missing). Error messages are shown by default; setting `quota.showErrors` to `false` hides them in the sidebar. A provider whose credentials are missing and has no earlier data is hidden in the sidebar either way — only the text report can show it when `showErrors` is `true`. See [Settings](settings.md#quota-settings).

A provider's bar and visible windows can also be tuned just for the sidebar with that provider's `showSidebarBar` and `sidebarWindow` settings — see [Per-provider display](settings.md#per-provider-display).

### Context

The **Tokens** row counts the tokens in the current context window and, when the model's limit is known, shows `used / limit` and a percentage. The percentage is the share of the model's limit that is in use, not a cost or a quota. If the limit is unknown, the row shows a plain token count and no bar or percentage.

### Recorded usage

These are the tokens OpenCode recorded for completed provider calls, split into input (fresh), cache read, cache write, output, and reasoning. Rows with zero tokens are left out. The **total** adds the buckets that are present.

The **cost** line is what OpenCode recorded. When OpenCode did not record a cost, the sidebar labels it **cost est** — a public-rate estimate, not a bill. In the `/tally` panel the total gets the suffix `(estimate)`, or `(partly estimated)` when part of a combined total is estimated. The text report uses headings instead: `ESTIMATED API-RATE COST` with an `ESTIMATED TOTAL` line, or `OPENCODE-RECORDED COST` when OpenCode supplied a cost. See [Understand the numbers](guides/understand-the-numbers.md).

**cache hit** shows the share of input tokens served from cache rather than read fresh, plus the estimated money saved.

### Context window

This section splits the conversation by source — for example system prompt, tool definitions, user text, tool output, assistant text, and reasoning. Providers report one context count per request, not its ingredients, so the split comes from local tokenization. When that split is close to the count OpenCode recorded, the panel scales it to match (and shows a scale such as `×0.99`); otherwise it is labeled a **local estimate**. The sidebar shows the split without the scale note.

### Warnings and Updated

- **`! N warnings`** — the report has caveats, such as an approximate tokenizer or unavailable live pricing. A warning qualifies part of the report; it does not necessarily make the whole report wrong. The panel lists the warnings in full.
- **`Updated <time>`** — when the sidebar last successfully refreshed, in 24-hour `HH:MM` format. It changes on each refresh, including after you enable a subscription; it is not the time the report was generated or the time quota was fetched. Before the first refresh completes, it falls back to the report's generated time.

A refresh runs every 60 seconds by default and again whenever the session finishes a turn. You can change the interval in [Settings](settings.md#sidebar-settings).

## What to do when a provider is missing

If the Quota section is empty, or a subscription you expected is absent:

1. Make sure the provider is enabled under `quota.providers` in your config. No quota appears until at least one provider is enabled — see [Connect subscriptions](guides/connect-subscriptions.md).
2. Check that the key is exactly the provider's ID, such as `codex` or `opencode-go`. The full list is in [Subscriptions](subscriptions.md).
3. Confirm its credentials are available (OpenCode sign-in, an auth file, an API key, or a CLI login, depending on the provider).
4. Keep `quota.enabled` set to `true` and make sure `quota` is in `sidebar.sections`.
5. Wait one refresh. Quota and sidebar settings take effect at the next refresh without a restart.
6. If the config has a syntax error, the sidebar shows a **Config error** line and keeps its last valid settings.

For a full list of states and the first action for each, see [Read the sidebar](guides/read-the-sidebar.md). To change which sections appear, see [Customize the sidebar](guides/customize-the-sidebar.md).

## Related

- [Settings](settings.md) — every sidebar and quota setting.
- [Reports](reports.md) — the panel and the text report.
- [Subscriptions](subscriptions.md) — the 14 supported subscriptions.
