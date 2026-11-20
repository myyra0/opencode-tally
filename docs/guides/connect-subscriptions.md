# Connect subscriptions

This guide gets a subscription's usage limits showing in the Tally sidebar. A **quota window** is a limit a subscription applies over time or as a balance — for example a rolling five-hour window or a remaining credit amount.

You only need to edit one file: `~/.config/opencode/tally-config.json`. Despite the `.json` name, comments and trailing commas are allowed. If you have not seen this file before, read [Settings](../settings.md#where-the-file-lives) first.

## 1. Check the credential

Tally reads credentials you already have where possible. Before editing the config, make sure your subscription is usable:

- For most providers, sign in to the provider in OpenCode as you normally would. Tally reads OpenCode's shared auth file automatically.
- For Codex, Tally can also read the Codex CLI auth file at `~/.codex/auth.json`, or an `authPath` you set.
- For `claude-code`, run `claude auth login` in the Claude Code CLI. Tally reads `~/.claude/.credentials.json` (`CLAUDE_CONFIG_DIR` respected); macOS may use Keychain. Tally never asks you to paste a Claude Code token.
- For `alibaba-token-plan`, the Bailian CLI (`bl`) must be installed and logged in, at version 1.15.0 or newer.
- For `qwen`, the `qwencloud` CLI must be installed and logged in.
- If a provider needs an API key instead, you can set `apiKey` in the config. It can be a literal value or an environment reference such as `"{env:MY_KEY}"`.

The full list of providers and where each gets its credential is in [Subscriptions](../subscriptions.md).

## 2. Enable one subscription

Add this to your config file. It connects Codex, which usually picks up your OpenCode sign-in:

```jsonc
{
  "quota": {
    "providers": {
      "codex": { "enabled": true }
    }
  }
}
```

If you already have other settings in the file, add the `"quota"` object alongside them rather than replacing the whole file.

## 3. Or enable two subscriptions

To connect more than one, add another key under `providers`. This example connects OpenCode GO and Codex:

```jsonc
{
  "quota": {
    "providers": {
      "opencode-go": {
        "enabled": true,
        "label": "OpenCode GO"
      },
      "codex": {
        "enabled": true,
        "label": "Codex"
      }
    }
  }
}
```

`label` is optional; it is a name of your choosing. The key (`opencode-go`, `codex`) must be the exact provider ID. See the [complete commented example](../examples/tally-config.jsonc) for more options, or the [schema](../../plugin/tally-config.schema.json) for every allowed key.

## 4. Wait for a refresh

Quota settings take effect at the next refresh — 60 seconds by default. No OpenCode restart is needed for changes under `quota` or `sidebar`. Keep a session open with the sidebar visible.

## 5. Verify it works

1. Look for the provider's name in the sidebar's **Quota** section. A heading with no rows means no provider is enabled yet.
2. Check that a window row appears beneath it: a percentage with a bar, a used/total count, or a remaining balance.
3. For a fuller view, run `/tally` and look at the **Quota** section, or run `/tally-report` and look for **QUOTAS**.
4. Check for a failure line: `! <message>` in the sidebar, or `Error: <message>` in the text report.

The **Updated** line shows when the sidebar last refreshed, not when quota was fetched. Quota uses its own refresh interval, so check the provider rows and their markers, not that time, to verify quota.

If the title ends in ` cached` or ` (stale)` in the sidebar (or the name ends in `(cached)` or `(stale)` in the text report), Tally has a connection problem but may still be showing earlier numbers. See [Read the sidebar](read-the-sidebar.md) for what each marker means.

## Connect Claude Code

1. Install Claude Code and run `claude auth login`.
2. In OpenCode, select **Claude Agent** in `/connect` if you also want to use it for chat.
3. Enable `claude-code` under `quota.providers`:

```jsonc
{
  "quota": {
    "providers": {
      "claude-code": { "enabled": true }
    }
  }
}
```

4. Save and wait one refresh.

What you should see: a `5h` row, a `weekly` row, and optionally `Opus`, `Sonnet`, and `extra usage` rows depending on your plan.

If nothing appears: confirm the CLI login, then the credentials path (`~/.claude/.credentials.json`, or `CLAUDE_CONFIG_DIR`), then restart or reload OpenCode.

## Nothing appears checklist

Work through these in order:

1. **No quota section at all** — make sure a session is open and the sidebar is visible. Then check that `sidebar.enabled` is not `false`, and that `"quota"` is in `sidebar.sections`. See [Customize the sidebar](customize-the-sidebar.md).
2. **Collection turned off** — check that `quota.enabled` is not `false` in [Settings](../settings.md#quota-settings).
3. **Wrong provider ID** — the key must match the list in [Subscriptions](../subscriptions.md#supported-subscriptions), for example `codex`, not `openai`.
4. **Provider not enabled** — the entry must have `"enabled": true`. Omitting it, or setting `false`, hides the provider.
5. **Credential missing** — sign in through OpenCode, supply `apiKey` or `authPath`, or make sure the required CLI is installed and logged in. In the sidebar, a provider with missing credentials and no earlier data is hidden even when `quota.showErrors` is `true`. The text report shows an `Error: <message>` line for it and hides it only when `showErrors` is `false`.
6. **Config error** — if the sidebar shows `Config error:`, fix the syntax in the config file. Tally keeps its last valid settings until the file parses again.
7. **Not waited long enough** — the provider list updates at the next refresh. If you changed an analysis flag instead, that needs a full OpenCode restart; sidebar and quota settings do not.

## If this goes wrong after it worked

- A ` cached` title with a `! <message>` line in the sidebar (or `(cached)` with `Error: <message>` in the text report) means the last fetch failed. Fix the named problem and wait for the next refresh.
- A ` (stale)` title in the sidebar (or `(stale)` in the text report) means successful numbers are older than about two refresh intervals. Check your connection, then wait.
- A balance provider with no percentage is normal — balances do not have a total to compare against.

## Related

- [Subscriptions](../subscriptions.md) — all 14 providers and their credentials
- [The sidebar](../sidebar.md) — what the quota rows mean
- [Settings](../settings.md) — all `quota.*` settings and defaults
