# Repository Guide

## Commands

- Install dependencies with `bun install`.
- Run the focused test file with `bun test test/translation.test.ts`.
- Run the complete verification gate with `bun run check:all`.
- `check:all` runs `typecheck`, tests, lint, zero-tolerance duplicate detection, unused-code detection, then the build, in that order.
- The pre-push hook runs `bun run check:all`; the pre-commit hook lints staged TypeScript files.

## Structure

- This is a single Bun TypeScript package, not a workspace or monorepo.
- `src/server.ts` is the OpenCode server plugin and transforms user chat messages through `experimental.chat.messages.transform`.
- `src/tui.tsx` is the TUI plugin; it persists the toggle in KV and publishes the toggle command event used by the server plugin.
- `src/translation.ts` contains shared Zod schemas, model parsing, translatable-part checks, prompt construction, and toggle parsing.
- `test/translation.test.ts` contains the current Bun unit tests; add behavior tests there when changing shared translation logic.

## Constraints

- Translation requires an explicit `small_model`; the server checks OpenCode config first and then the plugin option.
- Translation is fail-open: translation/session failures leave the original user text unchanged.
- Use the `golden-rules` skill at `.opencode/skills/golden-rules/SKILL.md` for the project's strict coding standards; in particular, do not add forced `as` casts.
- Keep generated build output in `dist/`; it is excluded from typecheck, lint, duplicate, and unused-code checks.
