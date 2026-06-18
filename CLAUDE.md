# Agnes Image Extension Guidelines

## Scope

This directory is a standalone SillyTavern third-party extension. It must stay independent from the surrounding `package_sender` application.

## Structure

- `manifest.json`: SillyTavern extension metadata and entry points.
- `index.js`: Browser-only extension logic. No build step and no external dependencies.
- `style.css`: Styles for the settings panel and result preview only.
- `README.md`: Installation, usage, and troubleshooting notes.

## Rules

- Do not commit API keys, generated images, chat exports, or user data.
- Keep network calls inside `callAgnesImageApi()` so auth and error handling stay auditable.
- Use `SillyTavern.getContext()` for chat and character data. Do not scrape DOM chat text unless the context API is unavailable.
- Prefer safe visual prompts by default: no nudity, no explicit sex, no visible minors in sexualized framing.
- Keep the extension dependency-free unless there is a concrete reason to add a build system.

## Verification

Minimum local verification after edits:

```bash
node --check index.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
```
