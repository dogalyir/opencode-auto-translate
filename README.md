# opencode-auto-translate

An OpenCode plugin that translates user prompts to English before they reach the main model, while preserving the original session history.

## Requirements

Configure an explicit `small_model`, because the plugin uses that exact OpenCode model for translation:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "small_model": "openai/gpt-4o-mini",
  "plugin": ["opencode-auto-translate"],
}
```

The model can instead be selected in plugin options. `variant` is passed to the translation request, and `lang` is the language intended for translated responses:

```jsonc
{
  "plugin": [
    [
      "opencode-auto-translate",
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

Supported output modes are `show original`, `replace original`, and `append translation`. Input translation currently changes only the model-facing message, so the main session counts the translated English text rather than both the original and translation. The current OpenCode plugin API does not expose a hook for replacing rendered assistant output after streaming; response display modes will become active when that API is available.

Add the TUI entrypoint to `tui.json`:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-auto-translate/tui"],
}
```

Use Ctrl+P, `/translate`, or Ctrl+Shift+T to toggle translation. The prompt badge shows the current state.

Translation is fail-open: if the translation model fails, the original text is sent unchanged.

## Publishing

Releases are published to npm by GitHub Actions when a GitHub Release is published. The release tag must match the package version, for example `v0.1.0` for version `0.1.0`.

The first npm publication must be performed manually. After the package exists, configure npm Trusted Publishing for `dogalyir/opencode-auto-translate` using workflow `publish.yml` and GitHub environment `npm`. Subsequent releases only require updating `version`, merging to `main`, and publishing the matching GitHub Release.

CI runs TypeScript typechecking, Bun tests, Oxlint, jscpd, Knip, Fallow dead-code and duplication analysis, the build, and an advisory Fallow health analysis.

## Development

```bash
bun install
  bun run typecheck
  bun test
  bun run lint
  bun run check:duplicates
  bun run check:unused
  bun run build
```

The project uses Bun equivalents of the requested quality tools: `bunx oxlint`, `bunx jscpd`, and `bunx knip`. Git hooks are installed by `bun run prepare`: staged TypeScript files are linted before commits, and the complete `check:all` pipeline runs before pushes.
