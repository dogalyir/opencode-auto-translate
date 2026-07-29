# Temporary Translation Sessions

The plugin creates a temporary OpenCode session for each translation request and deletes it after the response.

The `config` hook installs a hidden internal translator agent with a minimal prompt and no tools. Each prompt supplies the resolved `small_model`, an explicit translation system prompt, one text part, and `tools: { "*": false }`. Translator session IDs are excluded from every translation hook to prevent recursion.

Each request contains one minimal translation instruction in the prompt's `system` field and the original text unchanged in one text part. The system instruction requires translation-only output and prohibits wrappers, labels, explanations, and commentary. It is not OpenCode's base prompt.

Using OpenCode's session API delegates provider authentication, protocol handling, and OAuth behavior back to OpenCode. Temporary sessions still pass through OpenCode's normal session machinery, so clients may briefly expose session activity and normal session runtime/persistence overhead applies.

Failures remain fail-open and leave the original text unchanged. The longer-term improvement is a stateless provider-completion API in OpenCode. See [anomalyco/opencode#39243](https://github.com/anomalyco/opencode/issues/39243).
