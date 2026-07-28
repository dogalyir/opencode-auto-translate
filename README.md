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
- Fail open when translation fails.

## Compatibility

- OpenCode `>=1.18.5`
- Bun
- Node-style npm plugin loading

## Requirements

Configure an explicit `small_model`, because the plugin uses that OpenCode model for translation. Add the server plugin to `opencode.json` and the TUI plugin to `tui.json`.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "small_model": "openai/gpt-4o-mini",
  "plugin": ["opencode-auto-translate@latest"],
}
```

The model can instead be selected in plugin options. Precedence: `model`, global `small_model`, plugin `small_model`. `variant` is passed to translation requests. `lang` is the user's language and controls the TUI badge:

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

Runtime flow:

1. The user writes in `lang`.
2. User text is translated to English before the main model request.
3. The model receives English and responds in English.
4. Completed assistant `TextPart` content is translated to `lang` for display.

Input translation changes only the model-facing message, so visible user history keeps the original text. `output: "show original"` keeps assistant text in English. Other output modes display the English original plus the translation; the current API cannot safely hide the English text without breaking future model context.

The shared translation settings can be placed in the global `translate.json` file. It is loaded from `OPENCODE_CONFIG_DIR/translate.json`, then `$XDG_CONFIG_HOME/opencode/translate.json`, or finally `~/.config/opencode/translate.json`:

```json
{
  "enabled": true,
  "model": "openai/gpt-5.4-mini",
  "variant": "minimal",
  "lang": "Spanish",
  "input": "show original",
  "output": "show original + translation"
}
```

Options are applied in this order: built-in defaults, `translate.json`, inline plugin options, then persisted TUI enabled state. Inline options remain supported, but normal users do not need to configure the server and TUI separately.

For local development, add the package to `tui.json` only when testing the TUI entrypoint separately:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-auto-translate@latest"],
}
```

Use Ctrl+P, `/translate`, or Ctrl+Shift+T to toggle translation. The prompt badge shows the current state. `enabled` controls the initial state; TUI state is persisted in OpenCode KV and overrides it after toggling.

Translation is fail-open: if a translation request fails, the original text remains unchanged. The visible session history keeps original user text; the main model receives the English translation when successful.

The translation request uses a temporary internal session with the configured small model. Temporary sessions are deleted after each request, and repeated text is cached for the current plugin instance.

`input` currently supports only `show original` behavior. OpenCode exposes model-message transformation, not independent persisted-history rendering. `output` accepts `show original`, `show translation`, and `show original + translation`; the latter two preserve English context. Translation sessions use the configured model, are deleted afterward, and are excluded from the main session token count but still incur provider cost. Repeated text is cached per plugin instance.

Assistant prose is translated through `experimental.text.complete`. When output translation is enabled, the English original is followed by a horizontal separator and a `[Translation]` label. The system hook tells the main model to write assistant prose in English. Tool calls, tool arguments, tool outputs, reasoning, commands, paths, URLs, code, diffs, and errors remain unchanged. Native `question` prompts and permission prompts remain English because the current plugin API does not expose a safe mutable display hook for them.

For local development, run `bun run build`, then use file entrypoints instead of npm:

```jsonc
// ~/.config/opencode/opencode.json
{ "plugin": ["/absolute/path/to/opencode-auto-translate/dist/server.js"] }

// ~/.config/opencode/tui.json
{ "plugin": ["/absolute/path/to/opencode-auto-translate/dist/tui.js"] }
```

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
