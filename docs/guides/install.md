# Install

Tally is an OpenCode plugin. It is not a standalone program and does not analyze transcript files on its own.

## Before you start

Tally requires OpenCode V2 (version 2.0 or newer). Check your version:

```bash
opencode --version
```

## Install with OpenCode

```bash
opencode plugin add opencode-tally
```

This installs the package and adds it to OpenCode's global plugin configuration. Restart OpenCode, then continue with [Getting started](../getting-started.md).

## Install manually

If you prefer to manage the config yourself, add the package to the `plugins` key in `opencode.jsonc` — either the file in your project or the global one at `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-tally"]
}
```

Restart OpenCode after saving the file. The plugin registers its own commands, so there is no command file to create.

## Update

```bash
opencode plugin update opencode-tally
```

OpenCode checks for newer versions at startup but does not install them automatically. An entry pinned to an exact version, such as `opencode-tally@2.0.0`, is not updated.

## Uninstall

If you installed with `opencode plugin add`, remove the plugin from the global configuration:

```bash
opencode plugin remove opencode-tally
```

If you added it manually, delete `opencode-tally` from the `plugins` array in your `opencode.jsonc`. Restart OpenCode either way. Your `tally-config.json` settings are left in place; remove that file too if you do not plan to reinstall.

## If `/tally` is missing

1. Run `opencode plugin list` and check that a plugin with the ID `tally` is loaded.
2. If it is not listed, check that your config uses the `plugins` key and that the package name is correct.
3. Restart OpenCode completely — closing and reopening a session is not enough.
4. Check that your OpenCode version is 2.0 or newer.
5. If it still does not appear, see [Troubleshooting](../troubleshooting.md).

Once the command works, follow [Getting started](../getting-started.md) to open the panel and the text report.

## Related

- [Getting started](../getting-started.md)
- [Settings](../settings.md) — the `tally-config.json` file and every setting.
