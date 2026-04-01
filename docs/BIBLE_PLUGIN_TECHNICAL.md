# Bible Plugin Technical Notes

## Architecture

The Bible plugin is an OpenClaw extension that registers a native slash command through the plugin API.

Main pieces:
- `extensions/bible-plugin/index.ts`
  - plugin entrypoint
  - command registration
  - argument parsing
  - OpenRouter call
  - response assembly
- `extensions/bible-plugin/prompts/short.md`
  - short devotional prompt template
- `extensions/bible-plugin/prompts/study.md`
  - structured study prompt template
- `extensions/bible-plugin/openclaw.plugin.json`
  - plugin metadata and config schema

## Command flow

1. OpenClaw loads the plugin from the runtime extension root.
2. The plugin registers `/bible` with `api.registerCommand(...)`.
3. When OpenClaw matches `/bible ...`, it invokes the command handler.
4. The handler:
   - resolves plugin config from the live OpenClaw config
   - parses mode flags and the Bible reference
   - loads the prompt template
   - looks up the OpenRouter auth profile from `auth-profiles.json`
   - sends a direct OpenRouter request
   - normalizes JSON output fields
   - formats the final reply text
5. OpenClaw returns the handler result into the originating conversation.

## Config lookup

The handler reads config from the live OpenClaw config object passed into command execution.

Primary path:
- `config.plugins.entries["bible-plugin"].config`

Fallback behavior:
- missing values use built-in defaults

## Auth model

The plugin currently reads the OpenRouter API key from:
- `~/.openclaw/agents/main/agent/auth-profiles.json`

It uses:
- `openrouterProfile`

Default profile:
- `openrouter:default`

## Prompting

Two file-based prompt templates are used.

### `short.md`

Asks for concise devotional JSON fields intended to be collapsed into a Signal-friendly response.

### `study.md`

Asks for a richer structured JSON response with key points and fuller interpretation.

## Output normalization

The plugin normalizes model keys by lowercasing and converting spaces/hyphens to underscores.
This allows either of these to work safely:
- `historical context`
- `historical_context`

Study mode key point handling is tolerant to minor schema drift:
- canonical shape remains `key_points` as an array
- `keypoints` is accepted as an alias after key normalization
- string-based bullet/numbered content is split into up to 3 points for rendering
- if no usable points are present, `Key points:` is omitted

The plugin also strips fenced JSON if the model returns a code block.

## Error behavior

User-facing failures should stay short and safe:
- missing args -> usage response
- missing profile/key -> config/auth error response
- upstream model failure -> retry-later style response
- invalid model JSON -> parse error response

## Maintenance guidance

Safe places to change behavior:
- prompt wording in `prompts/*.md`
- response formatting helpers in `index.ts`
- config defaults in `index.ts`

Changes that should be done carefully:
- command contract
- auth profile lookup
- plugin ID in metadata
- output field names expected from prompts

## V2 design path

V2 should add a source abstraction that can fetch chapter text before prompting.

Recommended structure:
- keep `/bible` command parsing as-is
- add a source resolver layer
- support translation selection with a new flag
- pass fetched source text into the prompt
- keep short and study renderers intact

Topics to document in V2:
- Bible API provider setup
- translation mapping
- caching and rate-limits
- attribution and copyright constraints
