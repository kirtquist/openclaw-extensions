# Bible Plugin

Native OpenClaw `/bible` slash command plugin.

## Commands

- `/bible matthew 25`
- `/bible --study matthew 25`

## What it does

- short devotional chapter summaries
- study mode with more structure (big idea, **book context**—how the chapter fits the book’s story and major themes—historical context, key points, application, prayer)
- configurable OpenRouter or direct Ollama usage

## Configuration

- `provider` (`openrouter` or `ollama`)
- `baseUrl` (the full OpenAI-compatible chat-completions endpoint)
- `model` (passed directly to the endpoint; OpenClaw aliases are not resolved)
- `signalMaxChars`
- `defaultMode`
- `openrouterProfile` (used only with OpenRouter)

OpenRouter remains the default:

```json
{
  "provider": "openrouter",
  "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
  "model": "google/gemini-2.5-flash",
  "openrouterProfile": "openrouter:default"
}
```

For direct Ollama usage, configure the full OpenAI-compatible endpoint and the
actual Ollama model name:

```json
{
  "provider": "ollama",
  "baseUrl": "http://100.119.77.26:11434/v1/chat/completions",
  "model": "qwen3.5:27b"
}
```

Ollama requests do not load an OpenRouter auth profile or send an
`Authorization` header.

## Notes

V1 is LLM-only and does not fetch canonical Bible text.
Planned V2 adds a Bible API and translation selection.
