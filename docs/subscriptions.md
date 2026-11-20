# Subscriptions

Tally can read the usage limits of 14 subscriptions and show them in the sidebar's **Quota** section and in a **QUOTAS** section of the text report. Nothing is enabled by default, so you choose which ones to connect.

Four kinds of credentials are used, depending on the provider:

- **OpenCode auth** — Tally reads the sign-in information OpenCode already stores when you connect the provider in OpenCode. You usually do not need to configure anything.
- **Auth file** — the `authPath` setting points to a JSON auth file. Codex also looks at its own CLI auth file at `~/.codex/auth.json` by default.
- **API key** — the `apiKey` setting, which can also be an environment reference such as `"{env:MY_KEY}"`. This is needed when OpenCode's sign-in is not picked up or when you set a custom `baseUrl`.
- **CLI login** — the provider's own command-line tool must be installed and already logged in.

All of these are optional overrides in your config; use only the ones your setup needs. The settings live under `quota.providers` in `tally-config.json` — see [Settings](settings.md#providers) for the file location and rules.

## Supported subscriptions

The key in the first column is the exact provider ID to put in your config.

| Provider ID | Shown as | What it shows | Credential comes from |
| --- | --- | --- | --- |
| `alibaba-token-plan` | Alibaba Token Plan | The quota windows your plan reports (usually a monthly window), with reset times | The Bailian CLI (`bl`) login; version 1.15.0 or newer is required. Set `region` to `"international"` (default) or `"china"` for your account. |
| `codex` | Codex | A primary usage window and a secondary window, with reset countdowns | OpenCode's sign-in (access token and account ID). Falls back to `authPath` (the Codex CLI auth file by default) or `apiKey`. |
| `deepseek` | DeepSeek | Your remaining account balance in its currency | OpenCode's sign-in, `authPath`, or `apiKey`. |
| `zai` | ZAI | A 5-hour and a weekly window, as a percentage or used/total credits | OpenCode's sign-in, `authPath`, or `apiKey`. `authorizationScheme` can be `"raw"` (default) or `"bearer"`. |
| `synthetic` | Synthetic | A weekly credits window; older plans also report a 5-hour window | OpenCode's sign-in, `authPath`, or `apiKey`. |
| `minimax` | MiniMax | 5-hour and weekly percentages, with reset times | OpenCode's sign-in, `authPath`, or `apiKey`. |
| `moonshotai` | Moonshot AI | Your remaining USD balance | OpenCode's sign-in, `authPath`, or `apiKey`. |
| `moonshotai-cn` | Moonshot AI CN | Your remaining CNY balance | OpenCode's sign-in, `authPath`, or `apiKey`. The two Moonshot regions use separate credentials. |
| `qwen` | Qwen (or your plan name) | A credits window, as used/total or a percentage | The `qwencloud` CLI login; the CLI must be installed and signed in. |
| `opencode-go` | OpenCode GO | Rolling, weekly, and monthly percentages | OpenCode's sign-in, `authPath`, or `apiKey`. |
| `commandcode` | Command Code | 5-hour, weekly, and monthly windows, with reset times where available | OpenCode's sign-in, `authPath`, or `apiKey`. |
| `novita-ai` | Novita AI | Your remaining USD balance | OpenCode's sign-in, `authPath`, or `apiKey`. |
| `openrouter` | OpenRouter | Your key's spend limit as an amount used against the limit, or `spend limit` when no limit is set | OpenCode's sign-in, `authPath`, or `apiKey`. |
| `claude-code` | Claude Code | A 5-hour window, a weekly window, and Opus/Sonnet weekly windows plus extra usage when your plan reports them | The Claude Code CLI login (`claude auth login`), stored at `~/.claude/.credentials.json` (`CLAUDE_CONFIG_DIR` respected); macOS may use Keychain. |

A balance row shows an amount remaining rather than a percentage, because there is no total to compare it with. Some rows show a countdown to the next reset. Which rows appear depends on what the provider reports.

If you set a custom `baseUrl`, also provide an explicit `apiKey` or `authPath`; Tally will not reuse an automatically discovered credential for a custom address.

## Where credentials come from

Tally reuses credentials you already have. You never need to paste a Claude Code or Codex token into a config file. There are three sources:

- **OpenCode connections** — anything you connect through OpenCode's `/connect` (an API key or sign-in) is read from OpenCode automatically. This covers OpenAI/ChatGPT, Anthropic, DeepSeek, Moonshot/Kimi, MiniMax, OpenRouter, Synthetic, OpenCode GO, and other entries in the OpenCode catalog; the exact list depends on the OpenCode catalog.
- **Local CLI logins** — the provider's own command-line tool must be installed and already logged in: Claude Code (`claude auth login`), Codex (`codex`), Bailian (`bl`), and Qwen (`qwencloud`).
- **Manual config** — `apiKey` or `authPath` for anything Tally does not discover, or for a custom origin.

## Enable a subscription

1. Open (or create) `~/.config/opencode/tally-config.json`. See [Settings](settings.md#where-the-file-lives) for other operating systems.
2. Add the provider ID under `quota.providers`, with `"enabled": true`. For example, for Codex:

```jsonc
{
  "quota": {
    "providers": {
      "codex": { "enabled": true }
    }
  }
}
```

3. Save the file. Quota settings take effect at the next refresh (60 seconds by default); no restart is needed.
4. Wait for the refresh, then look at the **Quota** section in the sidebar or run `/tally-report` and look for **QUOTAS**.

You can give a provider your own name with `label`. For the sidebar, `showSidebarBar` (default `true`) hides that provider's bar while keeping its text, and `sidebarWindow` (default `"all"`) shows just one of its windows; valid values are `all`, `rolling`, `daily`, `weekly`, `monthly`, `credits`, and `other`, where `rolling` also matches a window labeled `5h`. Both affect only the sidebar — the panel and text report still show everything. Providers also accept credential keys such as `apiKey`, `authPath`, `baseUrl`, `authorizationScheme`, and `region` where needed. `showFooterBar` and `footerWindow` are accepted but not rendered. See [Settings](settings.md#per-provider-display), the [complete commented example](examples/tally-config.jsonc), and the [JSON schema](../plugin/tally-config.schema.json) for the full set of keys.

For a step-by-step version, see [Connect subscriptions](guides/connect-subscriptions.md).

## Remove a subscription

Set `"enabled": false`, or delete the provider's entry entirely:

```jsonc
{
  "quota": {
    "providers": {
      "codex": { "enabled": false }
    }
  }
}
```

The provider's row disappears at the next refresh. To stop collecting quota for every provider, set `"quota": { "enabled": false }` — see [Settings](settings.md#quota-settings).

## How to tell it is working

1. The provider's name appears as a block in the sidebar's **Quota** section (or the **QUOTAS** section of the text report). A **Quota** heading with no rows means no provider is enabled yet.
2. At least one window row appears underneath it, with a percentage, a count, or a balance.
3. There is no failure line: `! <message>` in the sidebar, or `Error: <message>` in the text report. In the sidebar a title ending in ` cached` or ` (stale)` means earlier numbers are being shown; the text report uses `(cached)` and `(stale)` after the provider name.

The **Updated** line at the bottom of the sidebar shows the sidebar's last successful refresh, not when quota was fetched. Quota has its own refresh interval, so rely on the provider rows (and their ` cached` / ` (stale)` markers) rather than that time to check quota.

If a block is marked ` cached` or ` (stale)` in the sidebar (or `(cached)` / `(stale)` in the text report), Tally is showing the last good numbers from an earlier fetch. Check the error message or the credential for that provider, then wait one refresh. If nothing appears at all, work through the checklist in [Connect subscriptions](guides/connect-subscriptions.md#nothing-appears-checklist).

## Related

- [Connect subscriptions](guides/connect-subscriptions.md)
- [Settings](settings.md) — all `quota.*` options and defaults
- [The sidebar](sidebar.md) — how quota rows look and what the state markers mean
