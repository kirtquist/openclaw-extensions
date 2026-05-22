# Bible Plugin

Native OpenClaw `/bible` slash command plugin.

## Commands

- `/bible matthew 25`
- `/bible --study matthew 25`

## What it does

- short devotional chapter summaries
- study mode with more structure (big idea, **book context**—how the chapter fits the book’s story and major themes—historical context, key points, application, prayer)
- direct OpenRouter usage

## Configuration

- `model`
- `signalMaxChars`
- `defaultMode`
- `openrouterProfile`

## Notes

V1 is LLM-only and does not fetch canonical Bible text.
Planned V2 adds a Bible API and translation selection.
