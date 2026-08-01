# Why This Plugin Uses an English-First Agent Loop

## Summary

`opencode-auto-translate` separates the language used to operate the coding
agent from the language shown to the user:

1. The user writes in their configured language.
2. The plugin translates natural-language input to English.
3. The main coding model reasons and responds in English.
4. The plugin translates assistant prose back to the configured language.
5. Code, tools, commands, paths, URLs, diffs, errors, and structured values are
   left unchanged.

This design is motivated by the current evidence that English remains the most
reliable shared medium for coding models, not by a claim that English is
intrinsically better than every other language or that translation is lossless.

## The Problem

Coding agents operate in a mixed-language environment. User instructions may be
written in Spanish, Japanese, Arabic, or another language, while the rest of
the software context is commonly dominated by English:

- source-code syntax and identifiers;
- package and API documentation;
- compiler and runtime diagnostics;
- command-line tools;
- repository instructions;
- issue trackers and code examples.

The model must therefore understand a natural-language request and connect it
to an overwhelmingly English technical context. Asking the main model to
translate, reason, edit code, interpret tool output, and translate its answer
at the same time creates unnecessary language transitions inside the agent
loop.

The plugin moves the user-language boundary to the edge of the system. The
main model receives an English request while retaining the technical context
that it needs to modify the repository.

## Evidence

### Multilingual capability is uneven

Anthropic's multilingual documentation reports performance relative to English
that varies by language and model. High-resource languages are often close to
English, while lower-resource languages show materially larger gaps. For
example, Anthropic reports the following Sonnet 4.5 relative scores in its
multilingual MMLU evaluation:

| Language | Relative score |
| -------- | -------------: |
| English  |           100% |
| Spanish  |          98.2% |
| German   |          97.0% |
| Japanese |          96.8% |
| Korean   |          96.7% |
| Swahili  |          91.1% |
| Yoruba   |          79.7% |

These figures are not coding-agent measurements and do not prove that a
translation layer improves every task. They do establish that language choice
can affect model reliability, especially for lower-resource languages.

Source: [Anthropic multilingual support](https://platform.claude.com/docs/en/build-with-claude/multilingual-support)

### Code generation is also language-sensitive

HumanEval-XL evaluates equivalent code-generation tasks across 23 natural
languages and 12 programming languages, producing 22,080 parallel prompts. Its
purpose is specifically to measure the effect of natural-language prompt
language on code generation rather than confusing natural languages with
programming languages.

Source: [HumanEval-XL](https://arxiv.org/abs/2402.16694)

### Broad multilingual reasoning gaps remain

MMLU-ProX evaluates equivalent reasoning questions across 29 languages. The
authors report persistent disparities between high-resource and low-resource
languages, with gaps of up to 24.3 percentage points in their evaluation.

Source: [MMLU-ProX](https://arxiv.org/abs/2503.10497)

### What the evidence does not prove

The available research does not establish that blindly translating every prompt
to English is always superior. In particular, the cited benchmarks do not fully
measure:

- mixed prompts containing prose, code, and shell commands;
- translation errors introduced before the coding model sees the request;
- culturally specific requirements;
- user preference and communication quality;
- every current frontier model;
- the exact OpenCode plugin pipeline.

Accordingly, this plugin treats English-first translation as a practical
engineering strategy with fail-open behavior, not as a universal linguistic
rule.

## Algorithm

### Input path

```text
receive user message
  -> identify translatable text parts
  -> skip synthetic, ignored, empty, and non-text parts
  -> translate natural-language text to English
  -> preserve the user's original display text when configured
  -> send only the English form to the main model
```

The translation prompt explicitly requires the translator to preserve Markdown,
code, URLs, filenames, commands, and placeholders. Translation output is
validated and cleaned before it is used. If model selection, authentication,
session creation, response parsing, or translation fails, the original text is
sent unchanged.

### Agent path

The main model is instructed to:

```text
Write all assistant prose in English.
Keep tool names, tool arguments, commands, paths, URLs, code, diffs, and tool outputs unchanged.
```

This keeps the model-facing conversation stable. English assistant prose also
provides a canonical source for the response translation step.

### Output path

```text
receive completed assistant text
  -> skip code and non-translatable content
  -> translate assistant prose from English to the configured language
  -> display English only or English plus translation
  -> keep the English source in conversation context
```

Keeping the English source is intentional. Hiding it can cause later model
turns to receive localized text instead of the canonical model-facing context.

### Interactive questions

Question prompts are localized for display, but selected answers are restored
to their original English values before the model receives them. This prevents
translated option labels from becoming new, unknown values in the agent's
conversation.

## Preservation Rules

The plugin must not translate or alter:

- tool names and tool arguments;
- tool output;
- reasoning content;
- source code and code fences;
- paths and filenames;
- URLs;
- shell commands;
- diffs;
- error messages;
- placeholders and structured data.

These are operational values, not prose. Altering them can change program
behavior, invalidate commands, break links, or make a patch impossible to
apply.

## Why Use a Small Model?

Translation is a bounded transformation, not the primary coding task. Using the
configured `small_model` or an explicit translation model keeps the expensive,
high-capability model focused on repository reasoning. The plugin also uses
short-lived translator sessions without tools, limiting the translator's scope
to text conversion.

This is a cost and isolation optimization, not an assumption that all small
models translate equally well. Users working with a low-resource language or
highly specialized terminology may benefit from configuring a stronger
translation model.

## Evaluation Plan

The correct way to validate this approach is an A/B comparison on real tasks:

1. Run the same task natively and through the English-first pipeline.
2. Use equivalent prompts rather than merely translating words literally.
3. Include high-resource and lower-resource languages.
4. Include prose-only, code-heavy, mixed-content, and multi-turn tasks.
5. Compare tests passed, patch correctness, tool-call validity, token usage,
   latency, and translation fidelity.
6. Record cases where native prompting wins.

HumanEval-XL and MMLU-ProX are useful external references, but plugin decisions
should ultimately be based on evaluations that include OpenCode sessions,
repository context, tool calls, and the languages used by actual users.

## Design Principles

- English-first is an implementation strategy, not a value judgment about users'
  languages.
- User-facing prose should remain in the user's configured language.
- Technical literals should remain byte-for-byte stable whenever possible.
- Translation failures must never replace valid user content with an error.
- The system should be measurable and reversible if future models remove the
  English-first advantage.

## References

- [Anthropic multilingual support](https://platform.claude.com/docs/en/build-with-claude/multilingual-support)
- [HumanEval-XL: A Multilingual Code Generation Benchmark](https://arxiv.org/abs/2402.16694)
- [MMLU-ProX: A Multilingual Benchmark for Advanced Large Language Model Evaluation](https://arxiv.org/abs/2503.10497)
