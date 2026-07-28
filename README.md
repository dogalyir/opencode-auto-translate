# opencode-auto-translate

[![npm version](https://img.shields.io/npm/v/opencode-auto-translate?logo=npm)](https://www.npmjs.com/package/opencode-auto-translate)
[![CI](https://github.com/dogalyir/opencode-auto-translate/actions/workflows/ci.yml/badge.svg)](https://github.com/dogalyir/opencode-auto-translate/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/dogalyir/opencode-auto-translate)](LICENSE)
[![OpenCode plugin](https://img.shields.io/badge/OpenCode-plugin-7c3aed)](https://opencode.ai/docs/plugins)

An OpenCode plugin that translates user prompts to English before they reach the main model, then translates assistant text back to the configured language.

## Features

- Translate user prompts to English before the main model request.
- Translate completed assistant prose back to the configured language.
- Keep tool calls, tool arguments, tool outputs, reasoning, code, paths, URLs, commands, diffs, and errors unchanged.
- Toggle with Ctrl+P, `/translate`, or Ctrl+Shift+T.
- Show an active-language badge in the TUI.
- Use OpenCode's `small_model` or an explicit plugin model.
- Configure the server and TUI from one global `translate.json` file.
- Persist the TUI toggle state through OpenCode KV.
- Fail open when translation fails.

## Compatibility

- OpenCode `>=1.18.5`
- Bun
- Node-style npm plugin loading

## Installation

Install the package once through OpenCode. A package can expose both targets, and this package does so with separate server and TUI entrypoints. The installer detects both targets and adds the package to both configuration files:

```bash
opencode plugin opencode-auto-translate@latest
```

```jsonc
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-auto-translate@latest"],
}
```

```jsonc
// ~/.config/opencode/tui.json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-auto-translate@latest"],
}
```

The package must not be combined into one module: OpenCode requires server and TUI modules to be target-exclusive. This package keeps the implementations in `src/server.ts` and `src/tui.tsx`, while sharing domain logic in `src/translation.ts` and configuration loading in `src/config.ts`.

For a server-only or headless installation, configure only the server entrypoint:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-auto-translate@latest"],
}
```

Server-only mode translates prompts and assistant text but does not provide the TUI toggle, keybind, badge, toast notifications, or KV persistence. A TUI-only installation cannot perform server message translation.

## Configuration

The recommended configuration is one global `translate.json` file. It is loaded from the first applicable location:

1. `$OPENCODE_CONFIG_DIR/translate.json`
2. `$XDG_CONFIG_HOME/opencode/translate.json`
3. `~/.config/opencode/translate.json`

The file is user-global only. Project-level `translate.json` files are not read.

```json
{
  "enabled": true,
  "model": "openai/gpt-5.6-luna",
  "variant": "minimal",
  "lang": "Spanish",
  "input": "show original",
  "output": "show translation",
  "small_model": "openai/gpt-4o-mini"
}
```

All fields are optional. Defaults are:

```json
{
  "lang": "English",
  "input": "show original",
  "output": "show original"
}
```

`translate.json` is validated with the same Zod schema used by both runtimes. Missing, unreadable, malformed, or invalid files fail open and fall back to inline options and defaults.

Options are merged in this order:

1. Built-in defaults.
2. Global `translate.json`.
3. Inline plugin options, when present.
4. Persisted TUI enabled state from OpenCode KV.

Inline options remain supported for compatibility, but they should normally be omitted so server and TUI cannot drift apart.

The translation model is selected with this precedence:

1. `model` from inline options or `translate.json`.
2. OpenCode's global `small_model`.
3. `small_model` from inline options or `translate.json`.

`model` and `small_model` must use the `provider/model` format. `variant` is passed to translation requests. `lang` controls the assistant output language and the TUI badge.

Inline options remain available when needed:

```jsonc
{
  "plugin": [
    [
      "opencode-auto-translate@latest",
      {
        "model": "openai/gpt-5.4-mini",
        "variant": "minimal",
        "lang": "Spanish",
        "enabled": true,
        "input": "show original",
        "output": "show original + translation",
      },
    ],
  ],
}
```

Do not duplicate these options in both `opencode.json` and `tui.json` when using `translate.json`.

Runtime flow:

1. The user writes in `lang`.
2. User text is translated to English before the main model request.
3. The model receives English and responds in English.
4. Completed assistant `TextPart` content is translated to `lang` for display.

Input translation changes only the model-facing message, so visible user history keeps the original text. `input` currently supports only `show original`; OpenCode exposes model-message transformation, not independent persisted-history rendering.

`output` supports three modes:

- `show original`: display only the English assistant text.
- `show translation`: display the English original, then a separator and the localized translation.
- `show original + translation`: display the English original, separator, `[Translation]`, and the localized translation.

The translation-inclusive modes currently render this format:

```text
English original

----------------------------------------
[Translation]
Localized translation
```

The English original is intentionally retained because hiding it can break future model context with the current OpenCode API.

## TUI Controls

```jsonc
// ~/.config/opencode/tui.json, only needed for a separate local/file setup
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-auto-translate@latest"],
}
```

With the normal package installation, OpenCode resolves the TUI target automatically. Use Ctrl+P, `/translate`, or Ctrl+Shift+T to toggle translation. The prompt badge shows the current state, for example `[translate: on -> Spanish]`.

The TUI reads persisted KV state first. If no KV state exists, it uses `enabled` from `translate.json`. During startup it publishes the initial state to the server without showing a toggle toast. User-triggered toggles update KV, update the badge, show a toast, and publish the state to the server. If a user-triggered publish fails, the local state is rolled back.

The translation request uses a temporary internal session with the configured small model. Temporary sessions are deleted after each request, and repeated text is cached for the current plugin instance. Translation sessions are excluded from the main session token count but still incur provider cost.

Translation is fail-open: if configuration lookup, session creation, translation, response parsing, or cleanup fails, the original content remains unchanged and the failure is logged without breaking the main request.

The system hook tells the main model to write assistant prose in English. Tool calls, tool arguments, tool outputs, reasoning, commands, paths, URLs, code, diffs, and errors remain unchanged. Native `question` prompts and permission prompts remain English because the current plugin API does not expose a safe mutable display hook for them.

## Local Development

Run `bun run build`, then configure the two file entrypoints directly:

```jsonc
// ~/.config/opencode/opencode.json
{ "plugin": ["/absolute/path/to/opencode-auto-translate/dist/server.js"] }

// ~/.config/opencode/tui.json
{ "plugin": ["/absolute/path/to/opencode-auto-translate/dist/tui.js"] }
```

When using this file-entrypoint setup, `translate.json` is still shared by both runtimes. Restart OpenCode after changing `opencode.json`, `tui.json`, or plugin files because OpenCode loads configuration and plugins at startup.

## Publishing

Releases are published to npm by GitHub Actions when a GitHub Release is published. The release tag must match the package version, for example `v0.1.0` for version `0.1.0`.

The first npm publication must be performed manually. After the package exists, configure npm Trusted Publishing for `dogalyir/opencode-auto-translate` using workflow `publish.yml` and GitHub environment `npm`. Subsequent releases only require updating `version`, merging to `main`, and publishing the matching GitHub Release.

CI runs TypeScript typechecking, Bun tests, Oxlint, jscpd, Knip, Fallow dead-code and duplication analysis, the build, and an advisory Fallow health analysis.

## Development

```bash
bun install
bun run check:all
```

`check:all` runs typechecking, tests, Oxlint, duplicate detection, Knip, Fallow, and the production build. The TUI build keeps `solid-js` external so it uses the host OpenTUI Solid runtime rather than bundling a second Solid runtime. Git hooks are installed by `bun run prepare`: staged TypeScript files are linted before commits, and the complete `check:all` pipeline runs before pushes.

The test suite covers model parsing, translatable-part filtering, prompt construction, display modes and separators, shared configuration precedence, server translation hooks, fail-open behavior, and TUI toggle registration.
