# Frequently asked questions

Short answers to the questions people ask most. The linked guides go into more detail.

- [There is no Tally block in the sidebar](#there-is-no-tally-block-in-the-sidebar)
- [The Quota section is empty](#the-quota-section-is-empty)
- [The cost shows $0.00](#the-cost-shows-000)
- [What does `(estimate)` mean?](#what-does-estimate-mean)
- [Why is there no context percentage?](#why-is-there-no-context-percentage)
- [What is the difference between `cached` and `(stale)`?](#what-is-the-difference-between-cached-and-stale)
- [A provider shows an error line](#a-provider-shows-an-error-line)
- [There are too many rows in the sidebar](#there-are-too-many-rows-in-the-sidebar)
- [Does Tally use tokens?](#does-tally-use-tokens)
- [Does Tally upload my data?](#does-tally-upload-my-data)
- [How do I add another subscription?](#how-do-i-add-another-subscription)
- [Does Tally support Claude Code?](#does-tally-support-claude-code)
- [How do I hide a provider or one of its windows?](#how-do-i-hide-a-provider-or-one-of-its-windows)
- [Why does the sidebar show only local numbers?](#why-does-the-sidebar-show-only-local-numbers)

## There is no Tally block in the sidebar

Open a session first — the block only appears while a session is open and the host sidebar is visible. It needs no command. If it is still missing, check `sidebar.enabled` in [Settings](settings.md#sidebar-settings); a change there takes effect at the next refresh (60 seconds by default), with no restart. Only the six `enable*` analysis flags need a restart, and they do not control sidebar visibility. For more, see [Troubleshooting](troubleshooting.md#the-sidebar-block-is-missing).

## The Quota section is empty

No subscription is enabled by default. Add a provider ID under `quota.providers` with `"enabled": true`, then wait one refresh. See [Connect subscriptions](guides/connect-subscriptions.md) or the [list of supported subscriptions](subscriptions.md).

## The cost shows $0.00

A cost of `$0.00` usually means no completed provider calls have been recorded for the session yet — for example the session is new or a turn is still running. Token count and cost come from completed calls, so they stay at zero until calls finish. A genuinely free (zero-priced) model can also show `$0.00`. See [Understand the numbers](guides/understand-the-numbers.md#tokens-and-cost-are-different-things).

## What does `(estimate)` mean?

It is a cost calculated from public API prices rather than an amount OpenCode recorded. The sidebar labels it `cost est`, the panel uses `(estimate)` or `(partly estimated)` when only part of a total is estimated, and the text report uses `ESTIMATED API-RATE COST`. An estimate is for understanding likely spend; it is not a bill. See [Understand the numbers](guides/understand-the-numbers.md#tokens-and-cost-are-different-things).

## Why is there no context percentage?

The **Context** row shows a percentage only when the model's context limit is known. If the limit is not reported, Tally shows a plain token count with no bar or percentage. If the percentage is present, it is the share of the model's window currently in use, not a cost or a quota. See [Understand the numbers](guides/understand-the-numbers.md#context-percentage).

## What is the difference between `cached` and `(stale)`?

Both mean the numbers on screen are from an earlier snapshot.

- **` cached`** (or `(cached)` in the text report) — the latest fetch failed, so Tally is showing the last successful numbers alongside a `! <message>` error line. Fix the named problem and wait for the next refresh. A provider with missing credentials and no earlier data is hidden in the sidebar instead.
- **` (stale)`** (or `(stale)` in the text report) — the numbers came from a successful fetch but are older than twice the quota refresh interval (about two minutes at the default of 60 seconds). Wait for the next refresh; if it stays stale, check the connection.

See [Read the sidebar](guides/read-the-sidebar.md#2-read-a-quota-row).

## A provider shows an error line

A `! <message>` line under a provider title names the problem — for example missing credentials, a rate limit, or a timeout. Fix what it says, then wait one refresh. You can hide error lines with `quota.showErrors` set to `false`, but that only hides the message. Work through the cases in [Troubleshooting](troubleshooting.md) or the [nothing-appears checklist](guides/connect-subscriptions.md#nothing-appears-checklist).

## There are too many rows in the sidebar

You can trim it without turning it off:

- `sidebar.sections` removes or reorders whole sections — see [Customize the sidebar](guides/customize-the-sidebar.md#1-add-remove-or-reorder-sections).
- A provider's `sidebarWindow` shows just one of its windows in the sidebar — see [below](#how-do-i-hide-a-provider-or-one-of-its-windows).
- `sidebar.showBars` and `sidebar.showPercentages` remove the bars and percentages — see [Customize the sidebar](guides/customize-the-sidebar.md#3-hide-bars-or-percentages).

## Does Tally use tokens?

Opening the `/tally` panel does **not** make a model request: it renders the analysis directly from the plugin, so it adds nothing to the session being measured. The sidebar also reads that analysis locally. The `/tally-report` command is the exception — it uses a model turn to print the report into the session, and that printing turn counts like any other turn. See [Reports](reports.md).

## Does Tally upload my data?

No. Report analysis reads the OpenCode session on your machine and builds the report locally; no session text or tool output is uploaded to any service. The subscription feature does contact the provider you connect so it can read that account's usage limits, using the credentials you supply or that OpenCode already stores. Those requests go to that provider, not to a Tally server.

## How do I add another subscription?

Add another provider ID under `quota.providers` with `"enabled": true`, alongside the ones you already have. For example:

```jsonc
{
  "quota": {
    "providers": {
      "codex": { "enabled": true },
      "opencode-go": { "enabled": true }
    }
  }
}
```

Each key must be an exact ID from [Subscriptions](subscriptions.md). Changes take effect at the next refresh; no restart is needed. See [Connect subscriptions](guides/connect-subscriptions.md#3-or-enable-two-subscriptions).

## Does Tally support Claude Code?

Yes. Tally reads your Claude Code usage limits from the Claude Code CLI login. To set it up:

1. Install Claude Code and run `claude auth login`.
2. In OpenCode, select **Claude Agent** in `/connect` if you also want to use it for chat.
3. Enable `claude-code` under `quota.providers` in your config.

You should then see a `5h` row, a `weekly` row, and optionally `Opus`, `Sonnet`, and `extra usage` rows. Tally never asks you to paste a Claude Code token; it reuses the CLI's login. See [Connect subscriptions](guides/connect-subscriptions.md#connect-claude-code).

## How do I hide a provider or one of its windows?

To hide a provider everywhere, remove its entry under `quota.providers` or set `"enabled": false` — see [Remove a subscription](subscriptions.md#remove-a-subscription).

To keep the provider but show fewer windows **in the sidebar only**, set its `sidebarWindow`. Valid values are `all` (the default), `rolling`, `daily`, `weekly`, `monthly`, `credits`, and `other`. The `rolling` choice also matches a window labeled `5h`. The `/tally` panel and the text report still show all windows. To keep all windows but hide just that provider's bar, set `showSidebarBar` to `false`; its text and percentage remain. See [Settings](settings.md#providers).

## Why does the sidebar show only local numbers?

The sidebar reads the current OpenCode session on your computer, so its numbers come from local data — there is no cloud dashboard behind them. Two specifics are worth knowing:

- The **Context window** split (system prompt, tool output, and so on) is a local token count. Providers report one context total per request, not what filled it, so the split by source is estimated from local text. The panel scales it to the recorded total when the two are close; the sidebar shows the local split without that scale note.
- A **cost est** label means the cost came from public prices, not from a recorded amount.

See [Understand the numbers](guides/understand-the-numbers.md#panel-versus-report) and the [report reference](report-reference.md).
