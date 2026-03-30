# Bible Plugin Implementation

## Goal

Provide an OpenClaw-native `/bible` slash command that works in Signal and returns a devotional Bible chapter summary without depending on the current scheduled Romans Python workflow.

## V1 features

- `/bible matthew 25`
  - default short devotional response
- `/bible --study matthew 25`
  - fuller structured study response
- `/bible`
  - usage/help response

## Response shape

### Short mode

Short mode returns a compact Signal-friendly message with:
- reference
- summary
- historical context
- application
- prayer

### Study mode

Study mode returns a richer response with:
- title/reference
- big idea
- historical context
- key points
- application
- prayer

## Config

Plugin config lives under the OpenClaw plugin entry for `bible-plugin`.

Supported config fields:
- `model`
  - default OpenRouter model ID
  - default: `google/gemini-2.5-flash`
- `signalMaxChars`
  - max characters for short mode
  - default: `1400`
- `defaultMode`
  - `short` or `study`
  - default: `short`
- `openrouterProfile`
  - auth profile name looked up in `~/.openclaw/agents/main/agent/auth-profiles.json`
  - default: `openrouter:default`

## Runtime install

Source repo:
- `/home/kirt/projects/openclaw/extensions`

Runtime location:
- `~/.openclaw/extensions`

Install/update:

```bash
openclaw plugins install ~/projects/openclaw/extensions/extensions/bible-plugin
openclaw plugins enable bible-plugin
systemctl --user restart openclaw-gateway
```

## Testing checklist

- `openclaw plugins inspect bible-plugin`
- `openclaw plugins list`
- send `/bible matthew 25` from Signal
- send `/bible --study matthew 25` from Signal
- confirm `/bible` returns usage help
- confirm short mode includes historical context in the message

## Known V1 limitations

- uses LLM knowledge only
- does not fetch canonical chapter text
- does not support translation selection yet
- should avoid presenting generated text as a direct Bible quotation

## V2 enhancement

Planned V2 adds a Bible API so users can request source-backed output and specify a translation, for example:

```text
/bible --translation esv matthew 25
```

This should preserve the same command structure and add a source layer rather than rewriting the plugin architecture.
