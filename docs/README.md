# Tally user docs

Tally is an OpenCode plugin that shows how many tokens a session used and what they were spent on. A **token** is a small piece of text — roughly a word or part of a word — that a language model reads and writes. Usage and limits are counted in tokens.

These pages are for people who use OpenCode. You do not need to read the plugin's code to use any of this.

## I want to…

| I want to… | Start here |
| --- | --- |
| Install Tally | [Install](guides/install.md) → [Getting started](getting-started.md) |
| Connect a subscription so quota appears | [Connect subscriptions](guides/connect-subscriptions.md) → [Subscriptions](subscriptions.md) |
| Change the sidebar | [Customize the sidebar](guides/customize-the-sidebar.md) → [Sidebar tour](guides/read-the-sidebar.md) → [Settings](settings.md) |
| Understand a number in a report | [Understand the numbers](guides/understand-the-numbers.md) → [Reports](reports.md) → [Report reference](report-reference.md) |
| Fix a problem | [Troubleshooting](troubleshooting.md) → [FAQ](faq.md) |

## Start here

If this is your first time, read [Getting started](getting-started.md). It takes you from a fresh install to an open report in a few steps.

## All pages

- [Getting started](getting-started.md) — install, restart, find the sidebar, open both reports.
- [Settings](settings.md) — the `tally-config.json` file and every setting you can change.
- [Install guide](guides/install.md) — install, update, uninstall, and fix a missing command.
- [Sidebar](sidebar.md) — the always-on sidebar block, section by section.
- [Reports](reports.md) — the `/tally` panel and the `/tally-report` text report.
- [Subscriptions](subscriptions.md) — the 14 supported subscriptions and their credentials.
- Guides: [Connect subscriptions](guides/connect-subscriptions.md), [Read the sidebar](guides/read-the-sidebar.md), [Understand the numbers](guides/understand-the-numbers.md), [Customize the sidebar](guides/customize-the-sidebar.md).
- [Report reference](report-reference.md) — section-by-section detail on what the report numbers mean and where they come from.
- [FAQ](faq.md) — quick answers to common questions.
- [Troubleshooting](troubleshooting.md) — symptom, cause, and fix for common problems.
- [Complete config example](examples/tally-config.jsonc) — every setting, with comments.

## Words you will see

- **Token** — a small piece of text a model reads or writes. Usage and limits are counted in tokens.
- **Context window** — the maximum number of tokens a model can consider in one request. Your conversation, instructions, and tool output all share it.
- **Cache read** — tokens the provider reuses from an earlier request because that text did not change. Reused tokens cost less than fresh ones.
- **Quota window** — a limit a subscription applies over a period of time or as a balance, such as a rolling five-hour window, a week, or a credit amount.

You only need to edit one file to change Tally's behavior. See [Settings](settings.md).
