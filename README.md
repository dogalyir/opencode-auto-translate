# opencode-auto-translate

An OpenCode plugin that translates user prompts to English before they reach the main model, while preserving the original session history.

## Requirements

Configure an explicit `small_model`, because the plugin uses that exact OpenCode model for translation:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "small_model": "openai/gpt-4o-mini",
  "plugin": ["opencode-auto-translate"]
}
```

Add the TUI entrypoint to `tui.json`:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-auto-translate"]
}
```

Use Ctrl+P, `/translate`, or Ctrl+Shift+T to toggle translation. The prompt badge shows the current state.

Translation is fail-open: if the translation model fails, the original text is sent unchanged.

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
