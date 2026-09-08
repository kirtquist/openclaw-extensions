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
- `reasoningEffort` (`none`, `low`, `medium`, `high`, or `max`; sent for Ollama)
- `requestTimeoutMs` (1,000–900,000 milliseconds)
- `signalMaxChars`
- `defaultMode`
- `openrouterApiKey` (used only with OpenRouter)

OpenRouter remains the default:

```json
{
  "provider": "openrouter",
  "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
  "model": "google/gemini-2.5-flash",
  "openrouterApiKey": "your-key"
}
```

For direct Ollama usage, configure the full OpenAI-compatible endpoint and the
actual Ollama model name:

```json
{
  "provider": "ollama",
  "baseUrl": "http://100.119.77.26:11434/v1/chat/completions",
  "model": "qwen3.5:27b",
  "reasoningEffort": "none",
  "requestTimeoutMs": 300000
}
```

Ollama requests do not load an OpenRouter API key or send an `Authorization`
header. Setting `reasoningEffort` to `none` prevents thinking-capable models
from consuming the response budget on hidden reasoning before returning the
requested JSON.

## Auth

The plugin needs an OpenRouter API key. Configure it in either place:

- plugin config field `openrouterApiKey`
- environment variable `OPENROUTER_API_KEY`

The plugin checks `openrouterApiKey` first, then `OPENROUTER_API_KEY`.
It does not read OpenClaw internal auth storage.

## Notes

V1 is LLM-only and does not fetch canonical Bible text.
Planned V2 adds a Bible API and translation selection.
