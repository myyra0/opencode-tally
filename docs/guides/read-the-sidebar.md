# Read the sidebar

A guided tour of the **Tally** block that sits in OpenCode's sidebar. The block appears whenever the sidebar is visible and a session is open; no command is needed. If you want to change what it shows, see [Customize the sidebar](customize-the-sidebar.md).

A **token** is a small piece of text a model reads or writes. A **context window** is the maximum number of tokens a model can consider in one request. A **quota window** is a limit a subscription applies over time or as a balance.

## 1. Find the block and its sections

Look for a bold **Tally** title, then up to four sections in this default order:

1. **Quota** — one named block per connected subscription.
2. **Context** — a single **Tokens** row: tokens used in the current context window and, when known, the model's limit and a percentage.
3. **Recorded usage** — input, cache read, cache write, output, and reasoning tokens OpenCode recorded, then `total`, `cost` (or `cost est`), and `cache hit`.
4. **Context window** — the conversation split by source, such as system prompt, tool definitions, user, tool output, assistant, and reasoning, ending in `total`.

Every configured section heading is shown, even when it has no rows — for example, a **Quota** heading can appear with no provider rows while no subscription is enabled. At the bottom you may see a warnings count (`! N warnings`) and an `Updated <time>` line.

## 2. Read a quota row

Each provider block has a title and one row per quota window:

- The row label tells you the window, for example `5h`, `weekly`, `monthly`, or a currency code.
- A percentage and bar show how much of that window is used, when the provider reports one.
- A short countdown, such as `25m` or `3d`, shows when the window resets, when the provider reports a reset time.
- A balance, such as `$12.40 remaining`, appears instead of a percentage when there is no total to compare it with.

Then check the title for a state marker and take the first action below.

| What you see | What it means | First action |
| --- | --- | --- |
| Provider title with no marker | The latest fetch succeeded | Nothing; read the numbers. |
| ` (stale)` | Numbers are from a successful fetch, but older than twice the refresh interval (about two minutes by default) | Wait for the next refresh. If it stays stale, check the account or connection. |
| ` cached` | The last fetch failed, so earlier numbers are shown with a `! <message>` line | Read the message, fix the named problem (often credentials), then wait one refresh. |
| `! <message>` under the title | The provider could not be read; with no earlier data, the block is hidden when the message says credentials are missing | Check credentials and the provider ID in `quota.providers`; see [Connect subscriptions](connect-subscriptions.md#nothing-appears-checklist). |
| No **Quota** heading | `quota` is not in `sidebar.sections`, or the sidebar is hidden | Add it back in [Customize the sidebar](customize-the-sidebar.md). |
| **Quota** heading but no provider rows | No subscription is enabled, or quota collection is off | Enable one under `quota.providers` and keep `quota.enabled` true. |
| `loading...` | The first fetch is still running | Wait a moment. |
| `Config error: …` at the top of the block | The config file could not be parsed | Fix the syntax in `tally-config.json`; the last valid settings are kept meanwhile. |
| `! N warnings` | The report has caveats, such as an approximate tokenizer | Run `/tally` to read the full warning text; a warning does not invalidate the whole report. |

The text report uses different strings: `Error: <message>` for failures, and `(cached)`, `(stale)`, or `(loading)` after the provider name.

## 3. Read the usage sections

- **Context** — if the row shows `42.3K / 200K`, the percentage is the share of the model's limit currently in use. If the limit is unknown, you will see a plain token count and no percentage.
- **Recorded usage** — these are tokens OpenCode recorded for completed calls. A `cost` line is recorded cost; `cost est` is a public-rate estimate, not a bill. `cache hit` is the share of input tokens served from cache and the money it saved.
- **Context window** — this is a local split of what is in the conversation. In the panel it is scaled to match OpenCode's recorded count when the two are close; otherwise it is labeled a local estimate.

For the meaning of each number, see [Understand the numbers](understand-the-numbers.md). For deeper detail, see the [report reference](../report-reference.md).

## 4. Know when it updates

The block refreshes every 60 seconds by default and again whenever the session finishes a turn. The `Updated <time>` line shows when the sidebar last successfully refreshed, in 24-hour `HH:MM` format — not when the report was generated or when quota was fetched. It advances on each refresh, including after you enable a subscription; before the first refresh it falls back to the report's time. Changes to `sidebar.*` and `quota.*` settings apply at the next refresh without a restart.

## Related

- [The sidebar](../sidebar.md) — annotated walkthrough and definitions
- [Customize the sidebar](customize-the-sidebar.md) — change sections, bars, and refresh
- [Settings](../settings.md) — every setting and default
