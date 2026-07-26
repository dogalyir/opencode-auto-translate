# opencode-auto-translate

An OpenCode plugin that translates user prompts to English before they reach the main model, while preserving the original session history.

## Requirements

Configure an explicit `small_model`, because the plugin uses that exact OpenCode model for translation. Add the package to both OpenCode configs: `opencode.json` loads the server plugin and `tui.json` loads the TUI plugin.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "small_model": "openai/gpt-4o-mini",
  "plugin": ["opencode-auto-translate@0.1.11"],
}
```

The model can instead be selected in plugin options. `model` takes precedence over `small_model` and the global OpenCode setting. `variant` is passed to the translation request, and `lang` controls the TUI badge language:

```jsonc
{
  "plugin": [
    [
      "opencode-auto-translate@0.1.11",
      {
        "model": "openai/gpt-5.4-mini",
        "variant": "minimal",
        "lang": "Spanish",
        "input": "show original + translation",
        "output": "append translation",
      },
    ],
  ],
}
```

Input translation changes only the model-facing message, so the visible session history keeps the original text while the model receives English. The current OpenCode plugin API does not expose a hook for translating rendered assistant output after streaming.

Add the TUI entrypoint to `tui.json`. Use the package root; OpenCode resolves `exports["./tui"]` automatically:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-auto-translate@0.1.11"],
}
```

Use Ctrl+P, `/translate`, or Ctrl+Shift+T to toggle translation. The prompt badge shows the current state.

Translation is fail-open: if the translation model fails, the original text is sent unchanged. The visible session history keeps the original user text, while the model-facing message receives the English translation.

The translation request uses a temporary internal session with the configured small model. Temporary sessions are deleted after each request, and repeated text is cached for the current plugin instance.

The `input` and `output` options are accepted for forward compatibility, but currently behave as `show original`; assistant response translation and alternate display modes are not implemented by the current OpenCode transform API.

For local development, build the package and use file entrypoints instead of npm:

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
