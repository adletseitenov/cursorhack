# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

«Поводырь» — a web navigator for blind users (Cursor Physical AI hackathon). The phone hangs on the chest, rear camera facing forward; a VLM analyzes frames in real time and guides the person to a spoken goal via Russian voice (Web Speech API) and vibration. Live at https://povodyr.netlify.app.

All UI text, VLM prompts, code comments, and docs are in Russian — keep them that way. Design specs live in `docs/superpowers/specs/`.

## Commands

There is no build step, no package.json, no linter, and no test suite. Verification is manual (run the app; camera requires HTTPS or localhost).

- `netlify dev` — local dev. Required to serve the `/api/vlm` function; opening `index.html` directly gives you a frontend with no backend.
- `netlify deploy --prod` — deploy (site is already linked; publishes `.` and `netlify/functions` per `netlify.toml`).
- `netlify env:set OPENROUTER_API_KEY <key>` + redeploy — configure the only secret.

## Architecture

Two files carry the whole app:

- **`index.html`** — the entire frontend: vanilla JS, no dependencies, single file by design (a v2 spec decision — don't split it into modules).
- **`netlify/functions/vlm.mjs`** — the entire backend: a proxy at `POST /api/vlm` that adds the OpenRouter key and forwards to `openrouter.ai/api/v1/chat/completions`.

### Security invariant: the key never leaves Netlify env

The repo is public (hackathon submission requirement) and OpenRouter auto-disables keys leaked in public repos — a key in frontend code or git kills the demo. All VLM traffic must go through `/api/vlm`. The proxy whitelists body fields (model, messages, response_format, max_tokens ≤ 300) so arbitrary requests can't ride on our key, and caps upstream at 9s (Netlify Free function limit is 10s).

### Navigation loop invariant: strictly one request in flight

The `busy` flag in `index.html` enforces it. The frame is captured at send time (not buffered), so loop latency *is* the guidance pace. The next tick fires after `TICK_MS` (300ms) *and* after the current utterance finishes speaking (with a 5s stuck-speech guard). Errors skip the tick but never kill the loop; 2+ consecutive errors trigger a spoken "остановитесь" warning. The debug buttons («Один кадр», «Шутаут») refuse to run while navigation is on to preserve this invariant.

### Model contract

The VLM must return JSON: `{"instruction": string, "direction": "forward"|"left"|"right"|"stop", "hazard": bool, "arrived": bool}`. `tolerantParse` strips markdown fences and extracts `{...}`; garbage responses skip the tick. The last 3 instructions are fed back in the user message to damp left/right oscillation (`history` resets whenever the goal changes). `arrived` must hold for 2 consecutive ticks — one false positive must not end guidance; on confirmed arrival the loop does NOT stop: the goal is cleared and the app returns to describe mode.

Two modes share the loop, switched by whether the goal field is empty: goal set → navigation prompt (300ms tick); empty → "describe what's ahead" prompt (1200ms tick, `arrived` ignored). Camera start auto-enters describe mode. The system prompts are shootout winners (see `docs/superpowers/specs/2026-07-08-povodyr-v3-voice-first.md`) — don't reword them casually; the losing variants failed the stairs-down safety case.

### Voice-first UX

Tapping anywhere on the page (except buttons, the goal input, and the judge area) triggers speech recognition. `parseVoiceCommand` routes phrases: stop words → stop navigation; «что вокруг/опиши» → describe mode; «хочу дойти до X» → goal X extracted; anything else → the whole phrase becomes the goal. Gotcha: JS regex `\b` does not work with Cyrillic — use `(\s|$)`.

### Model choice

`qwen/qwen3-vl-8b-instruct` (the `MODEL` const) won the latency shootout through the production proxy: ~1.0s warm with clean JSON. `anthropic/claude-haiku-4.5` is the backup (~1.7–2.2s, wraps JSON in markdown); `z-ai/glm-4.6v` is disqualified (6–9s, timeouts). Loop latency is the primary UX parameter — re-run the shootout («Шутаут» button hits all `SHOOTOUT_MODELS` with one frame) before switching models.

### Mobile speech/camera gotchas (already handled — don't regress)

The speech code in `index.html` encodes hard-won field fixes: the first utterance must be called synchronously from a user gesture (iOS); `cancel()` immediately followed by `speak()` drops the utterance on Android Chrome (hence the 60ms delay); a global `lastU` ref prevents GC from killing utterances mid-speech; an iOS mute-switch watchdog warns when speech silently fails; the `listening` flag mutes TTS while STT is active (otherwise the phone hears itself). Camera: wake lock while navigating, `cam.play()` on visibilitychange, `track.onended` announces camera loss. Vibration is a no-op on iOS — always wrapped in try/catch.
