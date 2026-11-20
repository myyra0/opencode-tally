# Customize the sidebar

All sidebar options live in `tally-config.json`, under the `"sidebar"` key. Changes apply at the next refresh — 60 seconds by default — with no OpenCode restart. See [Settings](../settings.md#sidebar-settings) for the full setting table and the file location.

A **section** is one of the blocks in the Tally sidebar: quota, context, recorded usage, or context window.

## 1. Add, remove, or reorder sections

Set `sections` to the sections you want, in the order you want them. Valid values are `quota`, `context`, `recorded`, and `contextWindow`.

This shows only two sections, with recorded usage first:

```jsonc
{
  "sidebar": {
    "sections": ["recorded", "context"]
  }
}
```

You do not have to list all four. If you list only unknown names, or an empty list, the four default sections come back.

## 2. Hide quota

To hide the quota section in the sidebar while leaving the rest:

```jsonc
{
  "sidebar": {
    "sections": ["context", "recorded", "contextWindow"]
  }
}
```

This hides the sidebar's quota section only. Quota collection continues, so quota still appears in the `/tally` panel and the text report. To stop collecting quota everywhere, set `"quota": { "enabled": false }` instead — see [Subscriptions](../subscriptions.md#remove-a-subscription).

## 3. Hide bars or percentages

Set `showBars` to `false` to remove the small bars; set `showPercentages` to `false` to remove the percentages. Both apply to the whole sidebar, including quota rows.

```jsonc
{
  "sidebar": {
    "showBars": false,
    "showPercentages": false
  }
}
```

You can also hide the warnings count with `"showWarnings": false` and the `Updated` line with `"showUpdated": false`.

## 4. Change the refresh interval

`refreshSeconds` is how often the sidebar refreshes. It must be a whole number of at least 15. This example refreshes every two minutes:

```jsonc
{
  "sidebar": {
    "refreshSeconds": 120
  }
}
```

The sidebar also refreshes whenever the session finishes a turn. Quota numbers use their own interval, `quota.refreshIntervalSeconds`, which is also 60 seconds by default — see [Settings](../settings.md#quota-settings).

## 5. Turn the sidebar off

```jsonc
{
  "sidebar": {
    "enabled": false
  }
}
```

The Tally block disappears. The `/tally` panel and `/tally-report` command still work. Set `enabled` back to `true` and the block returns at the next refresh; no restart is needed.

## 6. Tune a single provider

The settings above apply to the whole sidebar. For one subscription, two extra settings live on that provider's entry under `quota.providers` and affect only the sidebar:

- `showSidebarBar` (default `true`) — set to `false` to hide that provider's bar while keeping its text and percentage.
- `sidebarWindow` (default `"all"`) — show just one of that provider's windows in the sidebar. Valid values are `all`, `rolling`, `daily`, `weekly`, `monthly`, `credits`, and `other`. The `rolling` choice also matches a window labeled `5h`.

```jsonc
{
  "quota": {
    "providers": {
      "opencode-go": {
        "enabled": true,
        "showSidebarBar": false,
        "sidebarWindow": "weekly"
      }
    }
  }
}
```

The `/tally` panel and the text report still show every window and bar for that provider. See [Settings](../settings.md#per-provider-display) for the full description. Two other keys, `showFooterBar` and `footerWindow`, are accepted for compatibility with pasted configs but are not rendered — Tally has no prompt-footer surface.

## Complete example configurations

Everything in the file is optional; missing keys use the defaults. Copy this and remove what you do not want to change:

```jsonc
{
  "sidebar": {
    "enabled": true,
    "refreshSeconds": 60,
    "sections": ["quota", "context", "recorded", "contextWindow"],
    "showBars": true,
    "showPercentages": true,
    "showWarnings": true,
    "showUpdated": true
  },
  "quota": {
    "enabled": true,
    "refreshIntervalSeconds": 60,
    "requestTimeoutMs": 10000,
    "showErrors": true,
    "providers": {
      "codex": { "enabled": true }
    }
  }
}
```

A compact example with a single subscription, no bars, no warnings line, and a two-minute refresh:

```jsonc
{
  "sidebar": {
    "refreshSeconds": 120,
    "sections": ["quota", "recorded"],
    "showBars": false,
    "showPercentages": true,
    "showWarnings": false,
    "showUpdated": false
  },
  "quota": {
    "providers": {
      "opencode-go": { "enabled": true }
    }
  }
}
```

For a fully commented file covering analysis flags as well, see the [complete commented example](../examples/tally-config.jsonc). For every allowed key and default, see the [JSON schema](../../plugin/tally-config.schema.json).

## If this goes wrong

- **Changes do not appear** — wait one refresh interval. Only the six `enable*` flags need an OpenCode restart; `sidebar.*` and `quota.*` do not.
- **`Config error:` appears in the sidebar** — the file has invalid syntax. Comments and trailing commas are allowed, but brackets must match. Tally keeps its last valid settings until it parses again.
- **The block disappears after hiding sections** — you may have set `enabled: false`, or listed no valid section names. With no valid sections, the defaults return; with `enabled: false`, the whole block is hidden.

## Related

- [Read the sidebar](read-the-sidebar.md) — what each section means
- [The sidebar](../sidebar.md) — annotated walkthrough
- [Settings](../settings.md) — all sidebar and quota settings
