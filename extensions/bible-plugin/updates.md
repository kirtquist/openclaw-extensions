# Local Updates

This file tracks local changes made to the Bible plugin after the original repo state.

## 2026-05-21

### Native /bible command support
- Restored the Bible plugin as a native OpenClaw slash command so /bible is registered in the command registry again.
- Verified the working recovery path was: remove stale bible-plugin entries from ~/.openclaw/openclaw.json, restart the gateway, and reinstall the plugin from /home/kirt/projects/openclaw/extensions/extensions/bible-plugin.
- Confirmed Gmail can now execute /bible through native command dispatch instead of falling back to the general agent path.

### Study mode enhancements
- Added enhanced-study mode alongside short and study.
- Added prompts/enhanced-study.md for a deeper study response with explicit teaching, supported inferences, and citations.
- Updated argument parsing to support --enhanced-study, --enhanced, and --es as enhanced-study selectors.
- Expanded rendered output to include enhanced-study sections.

### Prompt safety and citations
- Tightened study prompting to avoid unsupported theological inferences.
- Added structure for supported inferences and citation-backed interpretation.
- Kept the plugin focused on real supporting Scripture references rather than invented cross-references.

### Build and packaging
- Added TypeScript build support with dist/ output and prompt copying during build.
- Added tsconfig.json and local package-lock data needed for repeatable builds on Pop!_OS.
- Updated plugin metadata to reflect enhanced-study config options and current packaged runtime output.

### Security note
- The plugin no longer reads OpenClaw internal auth storage.
- OpenRouter auth is explicit: set `plugins.entries.bible-plugin.config.openrouterApiKey` or `OPENROUTER_API_KEY`.
