# Getting started

This walks you from a fresh install to an open Tally report. It takes a few minutes and does not require reading code.

A **token** is a small piece of text a model reads or writes; usage and limits are counted in tokens. A **context window** is the maximum number of tokens a model can consider in one request. A **cache read** is text the provider reuses from an earlier request because it did not change. A **quota window** is a limit a subscription applies over time or as a balance. See the [glossary](README.md#words-you-will-see) if you want these in one place.

## 1. Check your OpenCode version

Tally needs OpenCode V2 (version 2.0 or newer):

```bash
opencode --version
```

If the version is older than 2.0, update OpenCode first.

## 2. Install the plugin

```bash
opencode plugin add opencode-tally
```

This adds the plugin to OpenCode's global configuration. If you prefer to add it yourself, or you installed manually, see the [install guide](guides/install.md).

## 3. Restart OpenCode

Close OpenCode completely and open it again. A restart is required after installing so the plugin can load. Start or resume a session with a few messages in it; Tally analyzes the session you are in.

## 4. Find the Tally sidebar block

Look in the sidebar of your OpenCode session for a block titled **Tally**. When the sidebar is visible and a session is open, the block appears there without you running a command; it can also be turned off in [Settings](settings.md#sidebar-settings). By default it shows, in this order:

1. **Quota** — your subscriptions and their limits, once you have connected one.
2. **Context** — tokens used in the current context window against the model's limit.
3. **Recorded usage** — input, cache read, cache write, output, and reasoning tokens that OpenCode recorded, plus cost and cache hit rate.
4. **Context window** — the tokens in your conversation, instructions, and tool output, split by source.

Below the sections you may see a warnings count and an "Updated" time. The block refreshes every 60 seconds by default and again whenever the session finishes a turn. The "Updated" time is when the sidebar last successfully refreshed — it is not the time the report was generated or the time quota was fetched.

If the sidebar block is missing or the quota area is empty, see [If this goes wrong](#if-this-goes-wrong).

## 5. Open the `/tally` panel

In the session, type:

```text
/tally
```

A panel opens beside the session. It is the same information as the sidebar in more detail, plus a last-request breakdown, always-sent context, tool output, and subagents when present.

Opening this panel makes **no model request**: it reads the analysis directly from the plugin and adds nothing to the session being measured. The panel reloads itself when the session finishes a turn.

| Key | What it does |
| --- | --- |
| `r` | Reload the report |
| `f` | Switch between the side panel and full screen |
| `↑` `↓` `PgUp` `PgDn` | Scroll |
| `esc` | Close the panel |

On a narrow terminal OpenCode shows the panel full screen. The command is also in the command palette as "Token usage report".

## 6. Open the `/tally-report` text report

```text
/tally-report
```

This asks the model to print the full text report into the session. Unlike the panel, this command uses a model turn to print the report. It is useful when you want to copy, search, or keep the text.

## 7. Confirm it works

You are set up when all of the following are true:

- The **Tally** block appears in the sidebar and updates its "Updated" time.
- `/tally` opens a panel without an error message.
- `/tally-report` prints a report with a token total and a cost line.
- Numbers do not stay at zero after the session has had a few exchanges.

## What you should see

- A header with the model name, the number of completed steps, and the tokenizer used.
- A cost and token total at the top. A cost marked `(estimate)` is a public-rate estimate, not a bill; `(partly estimated)` means part of the total is estimated.
- A **Context** section showing tokens used against the model's limit, when the limit is known.
- A **Recorded usage** section with a **Cache hit rate** line — the share of input tokens served from cache rather than read fresh.
- A **Context window** section. When the split is scaled to match OpenCode's recorded total, the panel shows the scale it used, for example `×0.99`.
- A **Last request** section once the session has made at least one request.
- An **Always-sent context** section for instructions and tool definitions sent with every request.
- **Tool output**, **Top contributors**, and **Subagents** sections when that data is present.

Some sections only appear once there is data for them. That is normal. To read what each number means, follow [Understand the numbers](guides/understand-the-numbers.md) or the [report reference](report-reference.md).

## If this goes wrong

| Symptom | What to do |
| --- | --- |
| `/tally` is not recognized | Run `opencode plugin list` and check that a plugin with the ID `tally` is loaded. Check that your config uses the `plugins` key, then restart OpenCode completely. See the [install guide](guides/install.md). |
| No Tally block in the sidebar | Open a session first, then check `sidebar.enabled` in [Settings](settings.md#sidebar-settings). If it is `false`, set it to `true`; the block appears at the next sidebar refresh, with no restart needed. A restart applies only to the six analysis flags, which do not control sidebar visibility. |
| The block is there but no quota shows | No subscription is enabled yet. Enable one in your config — see [Connect subscriptions](guides/connect-subscriptions.md). |
| The panel says "Could not load the report" | See [Troubleshooting](troubleshooting.md). |
| The panel stays on "Analyzing session…" | Wait for the current turn to finish, then press `r` to reload. |
| Numbers look different from OpenCode's own display | See [Understand the numbers](guides/understand-the-numbers.md) and the [report reference](report-reference.md); some numbers are recorded and others are local estimates. |
