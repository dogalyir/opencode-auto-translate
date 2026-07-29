import type { Plugin } from "@opencode-ai/plugin";
import { z } from "zod";
import { loadPluginOptions } from "./config";
import {
  configResponseSchema,
  messagesSchema,
  questionAnswersSchema,
} from "./schemas";
import { createDirectTranslator } from "./provider";
import type { MaybeUndefined } from "./types";
import {
  displayTranslation,
  hasDisplayedTranslation,
  isTranslatablePart,
  parseModelRef,
  parseToggleCommand,
  questionArgsSchema,
  TRANSLATION_ID,
  type ModelReference,
  type QuestionArgs,
  type TranslationDirection,
} from "./translation";

type MessageList = z.infer<typeof messagesSchema>;
type QuestionTranslation = { original: QuestionArgs; localized: QuestionArgs };
type ToolOutput = { output: string; metadata: unknown };

function parseMessages(value: unknown): MaybeUndefined<MessageList> {
  const parsed = messagesSchema.safeParse(value);
  if (!parsed.success) return undefined;
  return parsed.data;
}

function parseQuestionArgsTranslation(
  value: string,
): MaybeUndefined<QuestionArgs> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    return undefined;
  }
  const parsed = questionArgsSchema.safeParse(decoded);
  if (!parsed.success) return undefined;
  return parsed.data;
}

const AutoTranslatePlugin: Plugin = async ({ client, directory }, options) => {
  const pluginOptions = await loadPluginOptions(options);
  let enabled = pluginOptions.enabled === true;
  const cache = new Map<string, string>();
  const inFlight = new Map<string, Promise<MaybeUndefined<string>>>();
  const translatingParts = new Set<string>();
  const translatedParts = new Set<string>();
  const questionTranslations = new Map<string, QuestionTranslation>();
  const sessionAgents = new Map<string, string>();

  function isExcludedSession(sessionID: string): boolean {
    const agent = sessionAgents.get(sessionID);
    return agent !== undefined && pluginOptions.excluded_agents.includes(agent);
  }

  async function log(
    level: "warn" | "error",
    message: string,
    extra?: Record<string, unknown>,
  ) {
    try {
      await client.app.log({
        body: { service: TRANSLATION_ID, level, message, extra },
      });
    } catch (error) {
      // Logging must not break the fail-open translation path.
      console.warn("Auto-translation logging failed", String(error));
    }
  }

  /*
   * Translation deliberately does not use client.session.prompt(). That API
   * is OpenCode's agent execution boundary: even when a caller supplies an
   * empty `tools` object, OpenCode still resolves the selected agent and its
   * normal system prompt, permissions, MCP integrations, title generation,
   * events, and session persistence. In Web mode those temporary sessions
   * become visible to the user, which is the opposite of this plugin's job.
   *
   * The direct request below is intentionally narrower than OpenCode's normal
   * runtime. It uses the provider/model metadata already exposed by OpenCode,
   * resolves an API key from the public provider listing or the provider's
   * environment variables, and sends one OpenAI-compatible chat-completions
   * request with only the translation prompt. It never reads auth.json, never
   * implements OAuth refresh, never invokes an agent, and never sends tools or
   * project context. This is a deliberate compatibility boundary: providers
   * with non-OpenAI-compatible protocols or OAuth-only authentication fail
   * open until OpenCode exposes a stateless provider-completion API.
   *
   * Keep this comment with the implementation. Replacing this transport with
   * a session call would silently restore the agent/MCP behavior that prompted
   * this design, especially for users running `opencode web`.
   */
  const directTranslate = createDirectTranslator(
    () => client.provider.list({ query: { directory } }),
    log,
    pluginOptions.lang,
    pluginOptions.variant,
  );

  async function getTranslation(
    text: string,
    model: ModelReference,
    key: string,
    direction: TranslationDirection = "to-english",
  ) {
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const pending = inFlight.get(key);
    if (pending !== undefined) return pending;
    const request = directTranslate(text, model, direction);
    inFlight.set(key, request);
    let translated: MaybeUndefined<string>;
    try {
      translated = await request;
    } finally {
      inFlight.delete(key);
    }
    if (translated !== undefined) cache.set(key, translated);
    return translated;
  }

  async function translateQuestionArgs(
    args: QuestionArgs,
    model: ModelReference,
    callID: string,
  ): Promise<MaybeUndefined<QuestionArgs>> {
    const source = JSON.stringify(args);
    const translated = await getTranslation(
      source,
      model,
      `${model.providerID}/${model.modelID}:question:${callID}:${source}`,
      "from-english",
    );
    if (translated === undefined) return undefined;
    return parseQuestionArgsTranslation(translated);
  }

  async function restoreQuestionResult(
    callID: string,
    output: ToolOutput,
  ): Promise<void> {
    const translation = questionTranslations.get(callID);
    questionTranslations.delete(callID);
    if (translation === undefined) return;

    for (const [
      index,
      originalQuestion,
    ] of translation.original.questions.entries()) {
      const localizedQuestion = translation.localized.questions[index];
      if (localizedQuestion === undefined) continue;
      output.output = output.output
        .split(localizedQuestion.question)
        .join(originalQuestion.question);
      output.output = output.output
        .split(localizedQuestion.header)
        .join(originalQuestion.header);
      for (const [
        optionIndex,
        originalOption,
      ] of originalQuestion.options.entries()) {
        const localizedOption = localizedQuestion.options[optionIndex];
        if (localizedOption === undefined) continue;
        output.output = output.output
          .split(localizedOption.label)
          .join(originalOption.label);
        output.output = output.output
          .split(localizedOption.description)
          .join(originalOption.description);
      }
    }

    const parsedMetadata = questionAnswersSchema.safeParse(output.metadata);
    if (!parsedMetadata.success) return;
    const model = await resolveModel();
    const answers = await Promise.all(
      parsedMetadata.data.answers.map(async (questionAnswers, index) => {
        const originalQuestion = translation.original.questions[index];
        const localizedQuestion = translation.localized.questions[index];
        if (originalQuestion === undefined || localizedQuestion === undefined)
          return questionAnswers;
        return Promise.all(
          questionAnswers.map(async (answer) => {
            const optionIndex = localizedQuestion.options.findIndex(
              (option) => option.label === answer,
            );
            if (optionIndex >= 0) {
              const originalOption = originalQuestion.options[optionIndex];
              return originalOption === undefined
                ? answer
                : originalOption.label;
            }
            if (model === undefined || answer === "Unanswered") return answer;
            return (
              (await getTranslation(
                answer,
                model,
                `${model.providerID}/${model.modelID}:question-answer:${callID}:${index}:${answer}`,
                "to-english",
              )) ?? answer
            );
          }),
        );
      }),
    );
    output.metadata = { ...parsedMetadata.data, answers };
  }

  function selectModel(
    configuredSmallModel: unknown,
  ): MaybeUndefined<ModelReference> {
    const configured = z.string().safeParse(configuredSmallModel);
    const configuredReference = configured.success
      ? parseModelRef(configured.data)
      : undefined;
    const pluginModel =
      pluginOptions.model === undefined
        ? undefined
        : parseModelRef(pluginOptions.model);
    return pluginModel ?? configuredReference;
  }

  async function resolveModel(): Promise<MaybeUndefined<ModelReference>> {
    try {
      const response = await client.config.get({ query: { directory } });
      if (response.error !== undefined || response.data === undefined)
        return undefined;
      const parsedConfig = configResponseSchema.safeParse(response.data);
      if (!parsedConfig.success) return undefined;
      return selectModel(parsedConfig.data.small_model);
    } catch (error) {
      await log("warn", "Could not read OpenCode configuration", {
        error: String(error),
      });
      return undefined;
    }
  }

  return {
    event: async ({ event }) => {
      if (event.type !== "tui.command.execute") return;
      const command = event.properties.command;
      if (typeof command !== "string") return;
      const nextState = parseToggleCommand(command);
      if (nextState === undefined) return;
      enabled = nextState;
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      if (!enabled) return;
      const model = await resolveModel();
      if (model === undefined) {
        await log(
          "warn",
          "Translation is enabled but small_model is not configured",
        );
        return;
      }
      const messages = parseMessages(output.messages);
      if (messages === undefined) return;
      for (const [index, message] of messages.entries()) {
        const outputMessage = output.messages[index];
        if (outputMessage === undefined) return;
        Object.assign(outputMessage, message);
        if (message.info.agent !== undefined)
          sessionAgents.set(message.info.sessionID, message.info.agent);
        if (isExcludedSession(message.info.sessionID)) continue;
        if (message.info.role !== "user") continue;
        for (const part of message.parts) {
          if (!isTranslatablePart(part)) continue;
          const key = `${model.providerID}/${model.modelID}:${part.id}:${part.text}`;
          const translated = await getTranslation(part.text, model, key);
          if (translated !== undefined) part.text = translated;
        }
      }
    },
    "tool.execute.before": async (input, output) => {
      if (
        !enabled ||
        input.tool !== "question" ||
        isExcludedSession(input.sessionID)
      )
        return;
      const parsed = questionArgsSchema.safeParse(output.args);
      if (!parsed.success) return;
      const model = await resolveModel();
      if (model === undefined) return;
      try {
        const localized = await translateQuestionArgs(
          parsed.data,
          model,
          input.callID,
        );
        if (localized !== undefined) {
          output.args.questions = localized.questions;
          questionTranslations.set(input.callID, {
            original: parsed.data,
            localized,
          });
        }
      } catch (error) {
        await log("warn", "Question translation failed", {
          error: String(error),
        });
      }
    },
    "tool.execute.after": async (input, output) => {
      if (input.tool !== "question") return;
      try {
        await restoreQuestionResult(input.callID, output);
      } catch (error) {
        questionTranslations.delete(input.callID);
        await log("warn", "Question result restoration failed", {
          error: String(error),
        });
      }
    },
    "experimental.text.complete": async (input, output) => {
      if (!enabled || isExcludedSession(input.sessionID)) return;
      if (pluginOptions.output === "show original") return;
      if (hasDisplayedTranslation(output.text)) return;
      if (
        translatedParts.has(input.partID) ||
        translatingParts.has(input.partID)
      )
        return;
      translatingParts.add(input.partID);
      try {
        const original = output.text;
        if (original.trim().length === 0) return;
        const model = await resolveModel();
        if (model === undefined) return;
        const translated = await getTranslation(
          original,
          model,
          `${model.providerID}/${model.modelID}:response:${input.partID}:${original}`,
          "from-english",
        );
        if (translated === undefined) return;
        if (output.text !== original || hasDisplayedTranslation(output.text))
          return;
        output.text = displayTranslation(
          original,
          translated,
          pluginOptions.output,
        );
        translatedParts.add(input.partID);
      } finally {
        translatingParts.delete(input.partID);
      }
    },
    "experimental.chat.system.transform": async (_input, output) => {
      if (!enabled) return;
      if (_input.sessionID !== undefined && isExcludedSession(_input.sessionID))
        return;
      output.system.push(
        [
          "Write all assistant prose in English. The translation plugin renders it in the user's configured language.",
          "Keep tool names, tool arguments, commands, paths, URLs, code, diffs, and tool outputs unchanged.",
          "Native question prompts may remain English; preserve their exact meaning and answers.",
        ].join(" "),
      );
    },
  };
};

export default AutoTranslatePlugin;
