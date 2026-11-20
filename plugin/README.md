# Tally

Token usage, context, cache, cost, and subscription quota for OpenCode sessions.

An OpenCode V2 (2.0+) plugin that turns the usage your session has already recorded into a readable report. It keeps recorded provider numbers separate from local estimates. See the [full documentation](https://github.com/myyra0/opencode-tally/tree/main/docs) for guides and settings.

## Install

```bash
opencode plugin add opencode-tally
```

Or add the package to the `plugins` key in `opencode.jsonc` (in your project or at `~/.config/opencode/opencode.jsonc` for global use):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-tally"]
}
```

Restart OpenCode, then run `/tally` for the side panel or `/tally-report` for the text report.

## Configure (optional)

Create `~/.config/opencode/tally-config.json` to change settings. For example, to connect one subscription and hide the sidebar's bars:

```jsonc
{
  "sidebar": { "showBars": false },
  "quota": {
    "providers": {
      "codex": { "enabled": true }
    }
  }
}
```

All settings and their defaults are in the [settings reference](https://github.com/myyra0/opencode-tally/blob/main/docs/settings.md).

## Full documentation

Guides for install, getting started, settings, the sidebar, subscriptions, reports, FAQ, and troubleshooting live in the [docs folder](https://github.com/myyra0/opencode-tally/tree/main/docs).

## License

[MIT](https://github.com/myyra0/opencode-tally/blob/main/LICENSE)
