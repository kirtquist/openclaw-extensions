# Future Enhancements

## Per-mode providers and OpenRouter failover

See [PER_MODE_AND_FAILOVER_PLAN.md](./PER_MODE_AND_FAILOVER_PLAN.md) (local Ollama for leader/enhanced-study, Gemini Flash 3.x for short, Flash failover when Ollama is down). Tracks GitHub issue #11.

## Keep study and leader output synchronized

Separate `/bible --study` and `/bible --leader` requests are independent model generations, so their discussion questions may differ. A future version could preserve and reuse the exact participant study when producing a leader guide.

Possible design:

- Generate a study and assign it a short study ID.
- Cache the complete structured study result, including its questions, keyed by that ID and the normalized Bible reference.
- Allow leader mode to accept the study ID and ask the model only for suggested responses, follow-up prompts, facilitator notes, and a closing challenge based on the cached study.
- Render the cached participant content unchanged alongside the additional leader material, guaranteeing that answers remain aligned with the original questions.
- Define cache expiration, storage location, size limits, and behavior when an ID is missing or expired.
- Avoid including private participant responses or other sensitive discussion content in the cache.

A simpler interim workflow is to run leader mode first and treat its participant-study section as the source of truth for the group. The participant and leader portions are then produced in one generation and remain internally aligned.

## Web or mobile app (book / chapter / verse picker)

Expose the same study pipeline outside OpenClaw channels: user picks **book, chapter, and optional verses**, chooses a **mode** (short, study, leader, enhanced-study), and sees a **formatted** response on a page or in an app—not only as slash-command plain text.

### Why it fits this plugin

- Prompts already take a `{reference}` string (e.g. `Matthew 5:1-12`, `John 3`).
- Modes already produce structured JSON, then **render** to text (`renderStudyReply`, `renderLeaderReply`, etc.). A web UI would prefer **HTML or component-friendly sections** built from that same JSON (or parallel renderers).
- Per-mode providers and failover ([PER_MODE_AND_FAILOVER_PLAN.md](./PER_MODE_AND_FAILOVER_PLAN.md)) apply unchanged; only the **entry point** changes.

### Possible architecture (later)

```text
UI (web/app) → Bible API (OpenClaw gateway route or small sidecar) → shared core:
  parseReference · loadPrompt · generateSummary · normalize JSON · render
```

- **Reference input:** dropdowns + optional verse range; normalize to the same reference string the plugin uses today.
- **Output:** mode-specific layout (cards, headings, lists for key points / discussion questions / facilitator blocks).
- **Auth & limits:** API key or site login; rate limits; optional cache by reference + mode (see study cache ideas above).
- **V2 Bible text:** when a canonical text API exists, show scripture alongside generated study content ([README.md](./README.md) V2 note).

### Suggested phasing

1. **Extract or duplicate** “generate + render” behind a stable internal API (no UI yet).
2. **Static or SSR page** that calls the API (single tenant, your Ollama/OpenRouter config).
3. **Product hardening:** caching, study IDs for leader view, accessibility, print/PDF, i18n if needed.

### Out of scope for channel-plugin v1

No requirement to ship UI with per-mode failover; document here so API shape and JSON schema stay friendly to a future front end (stable field names, mode enum, error payloads matching [informative errors](./updates.md)).
