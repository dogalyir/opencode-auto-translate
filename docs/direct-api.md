# Direct Translation API

The plugin sends translation requests directly to the configured provider instead of creating an OpenCode session.

This keeps translation outside OpenCode's agent runtime: no agent, base prompt, MCP server, tool permissions, title generation, or temporary Web session is involved.

Each request contains one minimal translation instruction in a `system` message and the original text unchanged in a separate `user` message. The system instruction requires translation-only output and prohibits wrappers, labels, explanations, and commentary. It is not OpenCode's base prompt.

The current implementation supports providers exposing an OpenAI-compatible `/chat/completions` endpoint. Provider metadata and API keys are obtained through OpenCode's public provider listing when available, with standard provider environment variables as a fallback. The plugin does not read OpenCode's private credential files or implement provider-specific OAuth refresh.

Providers using another protocol or OAuth-only authentication remain unsupported and fail open. The longer-term improvement is a stateless provider-completion API in OpenCode. See [anomalyco/opencode#39243](https://github.com/anomalyco/opencode/issues/39243).
