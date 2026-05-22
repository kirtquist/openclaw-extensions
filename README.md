# OpenClaw Extensions

Development repo for personal OpenClaw extensions.

## Layout

- `extensions/`
  - one folder per OpenClaw extension
- `docs/`
  - implementation and maintenance notes

## Current extensions

- `bible-plugin`
  - native `/bible` slash command for OpenClaw
  - short devotional mode and study mode
  - direct OpenRouter usage with plugin config

## Runtime install

This repo is the development source of truth.
OpenClaw loads runtime extensions from `~/.openclaw/extensions`.

Install or refresh the Bible plugin from this repo:

```bash
openclaw plugins install ~/projects/openclaw/extensions/extensions/bible-plugin
openclaw plugins enable bible-plugin
systemctl --user restart openclaw-gateway
```

To **update** an already-installed copy from this repo, reinstall over it with `--force` (you do not need to uninstall first):

```bash
openclaw plugins install ~/projects/openclaw/extensions/extensions/bible-plugin --force
systemctl --user restart openclaw-gateway
```

Use `openclaw plugins uninstall bible-plugin` only when you want to remove the plugin entirely, not as a required step before upgrading.

Inspect plugin status:

```bash
openclaw plugins list
openclaw plugins inspect bible-plugin
openclaw plugins doctor
```

## Notes

- Keep secrets out of this repo.
- The current Bible plugin is intentionally separate from the scheduled Python-based Romans workflow.
- Planned V2: add a Bible API and translation selection while preserving the `/bible` command shape.
