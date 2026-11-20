# Settings

Tally has one settings file: `tally-config.json`. You only need it if you want to change the defaults. Everything in it is optional — any missing key uses its default.

A **token** is a small piece of text a model reads or writes. A **context window** is the maximum number of tokens a model can consider in one request. A **quota window** is a limit a subscription applies over time or as a balance.

## Where the file lives

Create the file at:

```text
~/.config/opencode/tally-config.json
```

- **Linux:** `~/.config/opencode/tally-config.json`
- **macOS:** `~/.config/opencode/tally-config.json`
- **Windows:** `.config\opencode\tally-config.json` inside your user folder, for example `C:\Users\<you>\.config\opencode\tally-config.json`

`~` means your home directory. The plugin uses this same `.config/opencode` folder in your home directory on every operating system — it does not use the Windows AppData folders for this file. If the file is missing or cannot be read, the plugin uses its built-in defaults.

## JSONC comments

Despite the `.json` name, you can add comments and trailing commas to this file. Both `//` and `/* … */` comments are supported. Comments make it easier to label what each setting does:

```jsonc
{
  // Turn the detailed subagent cost breakdown on
  "enableDetailedSubagentCostBreakdown": true,
  "sidebar": {
    "showBars": false, // hide the little bars
  },
}
```

If the file has a syntax error, Tally shows a config error in the sidebar and keeps the last valid sidebar and quota settings it had.

## Restart vs. hot reload

- **The six `enable*` flags** are read once when OpenCode starts. After changing any of them, **restart OpenCode** completely. In OpenCode V2 you can also set these same six flags as plugin `options` in `opencode.jsonc`; those take precedence over the file.
- **`sidebar.*` and `quota.*` settings** are re-read on every refresh. They take effect at the **next refresh** (60 seconds by default) without a restart. Adding or removing a provider appears in the quota list right away; fetching its numbers still happens once per quota refresh.

## Complete example

Copy this file, then remove the parts you do not want to change. Defaults are shown:

```jsonc
{
  // Analysis flags — restart OpenCode after changing these
  "enableContextBreakdown": true,
  "enableToolSchemaEstimation": true,
  "enableCacheEfficiency": true,
  "enableSubagentAnalysis": true,
  "enableDetailedSubagentCostBreakdown": false,
  "enableSkillAnalysis": true,

  // Sidebar — applies at the next sidebar refresh
  "sidebar": {
    "enabled": true,
    "refreshSeconds": 60,
    "sections": ["quota", "context", "recorded", "contextWindow"],
    "showBars": true,
    "showPercentages": true,
    "showWarnings": true,
    "showUpdated": true
  },

  // Subscription quota — applies at the next quota refresh
  "quota": {
    "enabled": true,
    "refreshIntervalSeconds": 60,
    "requestTimeoutMs": 10000,
    "showErrors": true,
    "providers": {}
  }
}
```

## Analysis flags

Set a flag to `false` to leave that analysis out of the report. These need an OpenCode restart.

| Setting | Default | What it controls |
| --- | --- | --- |
| `enableContextBreakdown` | `true` | The context breakdown by source (system, instructions, user, tool output, assistant). |
| `enableToolSchemaEstimation` | `true` | The estimate of how large the tool definitions are. |
| `enableCacheEfficiency` | `true` | The cache hit rate and savings lines. A cache hit is text the provider reused from an earlier request. |
| `enableSubagentAnalysis` | `true` | Whether child sessions (subagents) are included. |
| `enableDetailedSubagentCostBreakdown` | `false` | Expands each subagent into token and estimated cost buckets. Off by default to keep reports short. |
| `enableSkillAnalysis` | `true` | The available and loaded skills shown in the report. |

Example — skip skill analysis but expand subagent costs:

```jsonc
{
  "enableDetailedSubagentCostBreakdown": true,
  "enableSkillAnalysis": false
}
```

## Sidebar settings

These go inside the `"sidebar"` object. They apply at the next sidebar refresh, no restart needed.

| Setting | Default | What it controls |
| --- | --- | --- |
| `enabled` | `true` | Show or hide the whole Tally sidebar block. |
| `refreshSeconds` | `60` | How often the sidebar refreshes, in seconds. Must be a whole number of at least 15. |
| `sections` | `["quota", "context", "recorded", "contextWindow"]` | Which sections to show, and in what order. Valid values are `quota`, `context`, `recorded`, `contextWindow`. |
| `showBars` | `true` | Show the small bar next to each number. |
| `showPercentages` | `true` | Show the percentage next to each number. |
| `showWarnings` | `true` | Show the `! N warnings` line when the report has warnings. |
| `showUpdated` | `true` | Show the `Updated <time>` line at the bottom. |

Example — a compact sidebar that refreshes every two minutes:

```jsonc
{
  "sidebar": {
    "refreshSeconds": 120,
    "sections": ["context", "recorded"],
    "showBars": false,
    "showPercentages": true,
    "showWarnings": false,
    "showUpdated": false
  }
}
```

To turn the sidebar off entirely:

```jsonc
{
  "sidebar": {
    "enabled": false
  }
}
```

If you list only unknown section names, or an empty list, the four default sections come back.

## Quota settings

These go inside the `"quota"` object. They apply at the next quota refresh, no restart needed.

| Setting | Default | What it controls |
| --- | --- | --- |
| `enabled` | `true` | Turn subscription quota collection on or off. |
| `refreshIntervalSeconds` | `60` | How often quota numbers are fetched, in seconds. Must be a whole number of at least 15. |
| `requestTimeoutMs` | `10000` | How long to wait for one provider to answer, in milliseconds (1000 ms = 1 second). Must be at least 1000. |
| `showErrors` | `true` | Show provider error and diagnostic messages. Turn off to hide them. |
| `providers` | `{}` | Which subscriptions to read. Empty by default — no quota appears until you enable a provider here. |

Example — fetch quota every five minutes with a 15-second timeout, and hide provider errors:

```jsonc
{
  "quota": {
    "refreshIntervalSeconds": 300,
    "requestTimeoutMs": 15000,
    "showErrors": false
  }
}
```

### `providers`

`providers` is an object keyed by provider ID. Each enabled provider adds a quota row to the sidebar and a `QUOTAS` section to the text report. Supported IDs are:

`alibaba-token-plan`, `codex`, `claude-code`, `deepseek`, `zai`, `synthetic`, `minimax`, `moonshotai`, `moonshotai-cn`, `qwen`, `opencode-go`, `commandcode`, `novita-ai`, `openrouter`

The smallest useful config enables one provider:

```jsonc
{
  "quota": {
    "providers": {
      "codex": { "enabled": true }
    }
  }
}
```

Many providers pick up credentials you already have in OpenCode. If yours needs more, a provider entry can also accept `label` (a name of your choosing), the display settings described below, and — where the provider needs them — `apiKey`, `authPath`, `baseUrl`, `authorizationScheme`, or `region`. An `authPath` may also point to an auth file, and an `apiKey` can be an environment reference such as `"{env:MY_KEY}"`. For `claude-code`, `apiKey` is an OAuth access token and `authPath` defaults to the Claude Code credentials file.

#### Per-provider display

These settings affect only the **sidebar** view of that provider. The `/tally` panel and the text report still show every window and bar.

| Setting | Default | What it controls |
| --- | --- | --- |
| `showSidebarBar` | `true` | Show this provider's small bar in the sidebar. Set it to `false` to hide the bar while keeping the window label, value, and percentage. |
| `sidebarWindow` | `"all"` | Which quota window to show for this provider in the sidebar. Valid values are `all`, `rolling`, `daily`, `weekly`, `monthly`, `credits`, and `other`. `all` shows every window the provider reports. The `rolling` choice also matches a window labeled `5h`, so a five-hour window still appears. |

For example, to show only a provider's weekly window in the sidebar, and no bar:

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

`showFooterBar` and `footerWindow` are also accepted in a provider entry for compatibility with pasted usage-limits configs, but Tally has no prompt-footer surface, so they have no visible effect. You can leave them out.

Remove a provider's entry, or set `"enabled": false`, to stop reading it:

```jsonc
{
  "quota": {
    "providers": {
      "codex": { "enabled": false }
    }
  }
}
```

For step-by-step setup of a specific subscription, see [Connect subscriptions](guides/connect-subscriptions.md).
