# Troubleshooting

Work through the matching section below. Each one starts with what you see, the usual cause, and the fix. If your problem is not here, the [FAQ](faq.md) covers common questions.

## The plugin did not install

**Symptom** — `opencode plugin add opencode-tally` fails, or nothing appears after installing.

**Cause** — Tally needs OpenCode V2 (2.0 or newer), or the install command could not reach the package.

**Fix**

1. Check your version with `opencode --version`. Update OpenCode if it is older than 2.0.
2. Try the install command again: `opencode plugin add opencode-tally`.
3. If you install manually, make sure the package is in the `plugins` key of `opencode.jsonc` (project file or `~/.config/opencode/opencode.jsonc`) — see [Install](guides/install.md#install-manually).
4. Restart OpenCode completely.

## `/tally` or `/tally-report` is missing

**Symptom** — typing the command gives "not recognized", or it does not appear in the command palette.

**Cause** — the plugin is not loaded, or OpenCode has not been restarted since it was installed.

**Fix**

1. Run `opencode plugin list` and look for a plugin with the ID `tally`.
2. If it is not listed, check that your config uses the `plugins` key and the exact package name `opencode-tally`.
3. Restart OpenCode completely — closing and reopening a session is not enough.
4. Check that OpenCode is version 2.0 or newer.

Both commands are registered by the plugin; there is no command file to create. See [Install](guides/install.md#if-tally-is-missing).

## `Config error:` appears in the sidebar

**Symptom** — a `Config error: …` line at the top of the Tally block, and settings changes do not take effect.

**Cause** — `tally-config.json` could not be parsed. Tally keeps the last valid settings until the file parses again, so the block may look normal apart from the error line.

**Fix**

1. Open `~/.config/opencode/tally-config.json` (see [Settings](settings.md#where-the-file-lives) for other systems).
2. Fix the syntax. Brackets, braces, and quotes must match. Comments (`//` and `/* … */`) and trailing commas are allowed, so those are not the problem.
3. Compare against the [complete commented example](examples/tally-config.jsonc) or the [JSON schema](../plugin/tally-config.schema.json).
4. Save the file and wait one refresh. No restart is needed for `sidebar.*` or `quota.*` changes.

## A provider says credentials are missing

**Symptom** — a `! Codex credentials are missing` style message (or the same `<name> credentials are missing` for another provider), or the provider block is hidden in the sidebar.

**Cause** — Tally could not find a usable sign-in for that subscription. Each provider gets its credential from a different place.

**Fix**

- For most providers, sign in to the provider in OpenCode as you normally would; Tally reads OpenCode's shared auth file.
- For Codex, you can also use the CLI auth file at `~/.codex/auth.json`, or set `authPath`.
- For `alibaba-token-plan`, install and sign in to the Bailian CLI (`bl`) version 1.15.0 or newer. For `qwen`, install and sign in to `qwencloud`.
- Otherwise set `apiKey` (which can be an environment reference such as `"{env:MY_KEY}"`) or `authPath` on that provider.
- If you set a custom `baseUrl`, also supply an explicit `apiKey` or `authPath` — Tally will not reuse an auto-discovered credential for a custom address.

The full list is in [Subscriptions](subscriptions.md), with setup steps in [Connect subscriptions](guides/connect-subscriptions.md#1-check-the-credential).

## Network errors, rate limits, and timeouts

**Symptom** — a `!` line under a provider such as `Provider rate limit reached`, `Provider request timed out`, `Provider request failed`, or `Provider command timed out`. The title may end in ` cached` if earlier numbers are still available.

**Cause** — the provider's usage endpoint was slow, unreachable, or returned HTTP 429; a CLI-based provider could not run or finish in time. These are usually temporary.

**Fix**

1. Wait one refresh and check again; a brief rate limit often clears on its own.
2. Check your network connection and whether the provider's service is reachable.
3. For a CLI-based provider, confirm its command is installed and logged in (see the credentials section above).
4. If requests keep timing out, raise `quota.requestTimeoutMs` (minimum 1000 ms, default 10000). If you are hitting rate limits, raise `quota.refreshIntervalSeconds` so quota is fetched less often (minimum 15 seconds, default 60). See [Quota settings](settings.md#quota-settings).
5. If it stays ` cached`, the title keeps the last good numbers; fix the named problem to get a fresh snapshot.

## Data looks stale or marked `cached`

**Symptom** — a provider title ends in ` (stale)` or ` cached` (or `(stale)` / `(cached)` in the text report).

**Cause** — `stale` means the data came from a successful fetch but is older than twice the quota refresh interval (about two minutes at the default of 60 seconds). `cached` means the latest fetch failed and Tally is showing the last successful numbers instead.

**Fix**

- `stale`: wait for the next refresh. If it persists, check the connection and your quota refresh interval.
- `cached`: read the `! <message>` line (or `Error: <message>` in the text report), fix the named problem, and wait one refresh. See [Read the sidebar](guides/read-the-sidebar.md#2-read-a-quota-row) and [FAQ](faq.md#what-is-the-difference-between-cached-and-stale).

The sidebar's `Updated` line shows when the sidebar last refreshed. It is not the quota fetch time, so do not use it to judge whether quota data is fresh — read the provider rows and their markers instead.

## No provider rows under Quota

**Symptom** — the **Quota** heading is present but empty, or a provider you expected is missing.

**Cause** — no provider is enabled, the ID is misspelled, credentials are missing, or quota collection is turned off.

**Fix**

1. Enable the provider under `quota.providers` with `"enabled": true`.
2. Use the exact provider ID from [Subscriptions](subscriptions.md#supported-subscriptions), for example `codex`, not `openai`.
3. Keep `quota.enabled` set to `true` and make sure `"quota"` is in `sidebar.sections`.
4. Confirm its credentials are available (see the credentials section above).
5. Wait one refresh. Quota and sidebar settings apply at the next refresh, with no restart.

The full ordered checklist is in [Connect subscriptions](guides/connect-subscriptions.md#nothing-appears-checklist).

## The sidebar block is missing

**Symptom** — no **Tally** block in the sidebar, with or without other symptoms.

**Cause** — no session is open, the host sidebar is hidden, or `sidebar.enabled` is `false`.

**Fix**

1. Open a session and make sure the host sidebar is visible. The block needs no command.
2. Check `sidebar.enabled` in [Settings](settings.md#sidebar-settings). If it is `false`, set it to `true`.
3. Wait one refresh (60 seconds by default). The block returns at the next refresh with no restart.

Changing one of the six `enable*` analysis flags does require a restart, but those flags do not control sidebar visibility. See [Customize the sidebar](guides/customize-the-sidebar.md#5-turn-the-sidebar-off).

## The layout looks wrong or clipped

**Symptom** — the sidebar text is cut off, or the panel fills the whole screen when you expected a side panel.

**Cause** — the sidebar is a compact, fixed-width block; a very narrow terminal clips what does not fit. OpenCode also shows the `/tally` panel full screen when the terminal is narrow.

**Fix**

- Widen the terminal window if sidebar rows are clipped.
- Press `f` in the panel to toggle between full screen and the side panel.
- If the sidebar is too busy, hide sections with `sidebar.sections` or turn off bars and percentages — see [Customize the sidebar](guides/customize-the-sidebar.md).

## Still stuck

If none of the above helps, check the [FAQ](faq.md) and the relevant guide, then open an issue with your OpenCode version, the exact error text, and the contents of your config file with any secrets removed.
