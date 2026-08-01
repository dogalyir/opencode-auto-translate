import type { Plugin } from "@opencode-ai/plugin";
import { z } from "zod";
import { loadPluginOptions } from "./config";
import {
  configResponseEnvelopeSchema,
  configResponseSchema,
  questionAnswersSchema,
} from "./schemas";
import { createSessionTranslator, TRANSLATOR_AGENT } from "./provider";
import type { MaybeUndefined, QuestionTranslation, ToolOutput } from "./types";
import { parseMessages } from "./server-parsing";
import {
  displayTranslation,
  displayTranslationFailure,
  extractOriginalTranslation,
  extractTranslatedTranslation,
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

const AutoTranslatePlugin: Plugin = async ({ client, directory }, options) => {
  const MAX_RETAINED_ENTRIES = 500;
  const pluginOptions = await loadPluginOptions(options);
  let enabled = pluginOptions.enabled === true;
  const cache = new Map<string, string>();
  const inFlight = new Map<string, Promise<MaybeUndefined<string>>>();
  const translatingParts = new Set<string>();
  const translatorSessions = new Set<string>();
  const translatedParts = new Set<string>();
  const questionTranslations = new Map<string, QuestionTranslation>();
  const sessionAgents = new Map<string, string>();

  function remember<K, V>(map: Map<K, V>, key: K, value: V, limit: number): void {
    map.delete(key);
    map.set(key, value);
    while (map.size > limit) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) return;
      map.delete(oldest);
    }
  }

  function rememberSet(set: Set<string>, value: string, limit: number): void {
    set.delete(value);
    set.add(value);
    while (set.size > limit) {
      const oldest = set.values().next().value;
      if (oldest === undefined) return;
      set.delete(oldest);
    }
  }

  function isExcludedSession(sessionID: string): boolean {
    const agent = sessionAgents.get(sessionID);
    return agent !== undefined && pluginOptions.excluded_agents.includes(agent);
  }

  async function log(
    level: "info" | "warn" | "error",
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

  const translator = createSessionTranslator(
    client,
    directory,
    pluginOptions.lang,
    log,
    translatorSessions,
  );

  async function getTranslation(
    text: string,
    model: ModelReference,
    key: string,
    direction: TranslationDirection = "to-english",
  ) {
    const startedAt = Date.now();
    const cached = cache.get(key);
    if (cached !== undefined) {
      if (pluginOptions.verbose)
        await log("info", "Translation cache hit", {
          direction,
          chars: text.length,
          ms: Date.now() - startedAt,
        });
      return cached;
    }
    const pending = inFlight.get(key);
    if (pending !== undefined) return pending;
    const request = translator.translate(text, model, direction);
    inFlight.set(key, request);
    let translated: MaybeUndefined<string>;
    try {
      translated = await request;
    } finally {
      inFlight.delete(key);
    }
    if (translated !== undefined) {
      remember(cache, key, translated, MAX_RETAINED_ENTRIES);
    }
    if (pluginOptions.verbose)
      await log("info", "Translation completed", {
        direction,
        charsIn: text.length,
        charsOut: translated === undefined ? 0 : translated.length,
        ms: Date.now() - startedAt,
      });
    return translated;
  }

  async function getBatchTranslation(
    texts: readonly string[],
    model: ModelReference,
    direction: TranslationDirection,
  ): Promise<MaybeUndefined<string[]>> {
    if (texts.length === 0) return [];
    return translator.translateBatch(texts, model, direction);
  }

  async function translateQuestionArgs(
    args: QuestionArgs,
    model: ModelReference,
  ): Promise<MaybeUndefined<QuestionArgs>> {
    const fields: string[] = [];
    for (const question of args.questions) {
      fields.push(question.question, question.header);
      for (const option of question.options) fields.push(option.label, option.description);
    }
    const translated = await getBatchTranslation(fields, model, "from-english");
    if (translated === undefined || translated.length !== fields.length) return undefined;
    let index = 0;
    const questions = args.questions.map((question) => {
      const questionText = translated[index++];
      const header = translated[index++];
      if (questionText === undefined || header === undefined) return undefined;
      const options = question.options.map(() => {
        const label = translated[index++];
        const description = translated[index++];
        if (label === undefined || description === undefined) return undefined;
        return { label, description };
      });
      if (options.some((option) => option === undefined)) return undefined;
      return {
        question: questionText,
        header,
        options: options.filter((option) => option !== undefined),
        ...(question.multiple === undefined ? {} : { multiple: question.multiple }),
      };
    });
    if (questions.some((question) => question === undefined)) return undefined;
    return {
      questions: questions.filter((question) => question !== undefined),
    };
  }

  async function restoreQuestionResult(callID: string, output: ToolOutput): Promise<void> {
    const translation = questionTranslations.get(callID);
    questionTranslations.delete(callID);
    if (translation === undefined) return;

    for (const [index, originalQuestion] of translation.original.questions.entries()) {
      const localizedQuestion = translation.localized.questions[index];
      if (localizedQuestion === undefined) continue;
      output.output = output.output
        .split(localizedQuestion.question)
        .join(originalQuestion.question);
      output.output = output.output.split(localizedQuestion.header).join(originalQuestion.header);
      for (const [optionIndex, originalOption] of originalQuestion.options.entries()) {
        const localizedOption = localizedQuestion.options[optionIndex];
        if (localizedOption === undefined) continue;
        output.output = output.output.split(localizedOption.label).join(originalOption.label);
        output.output = output.output
          .split(localizedOption.description)
          .join(originalOption.description);
      }
    }

    const parsedMetadata = questionAnswersSchema.safeParse(output.metadata);
    if (!parsedMetadata.success) return;
    const model = await resolveModel();
    const customAnswers: Array<{
      questionIndex: number;
      answerIndex: number;
      text: string;
    }> = [];
    const answers = parsedMetadata.data.answers.map((questionAnswers, questionIndex) =>
      questionAnswers.map((answer, answerIndex) => {
        const originalQuestion = translation.original.questions[questionIndex];
        const localizedQuestion = translation.localized.questions[questionIndex];
        if (originalQuestion === undefined || localizedQuestion === undefined) return answer;
        const optionIndex = localizedQuestion.options.findIndex(
          (option) => option.label === answer,
        );
        if (optionIndex >= 0) {
          const originalOption = originalQuestion.options[optionIndex];
          if (originalOption === undefined) return answer;
          return originalOption.label;
        }
        if (model !== undefined && answer !== "Unanswered" && answer.trim().length > 0)
          customAnswers.push({ questionIndex, answerIndex, text: answer });
        return answer;
      }),
    );
    if (model !== undefined && customAnswers.length > 0) {
      const translatedAnswers = await getBatchTranslation(
        customAnswers.map((answer) => answer.text),
        model,
        "to-english",
      );
      if (translatedAnswers !== undefined) {
        for (const [answerIndex, customAnswer] of customAnswers.entries()) {
          const translatedAnswer = translatedAnswers[answerIndex];
          const questionAnswers = answers[customAnswer.questionIndex];
          if (translatedAnswer !== undefined && questionAnswers !== undefined)
            questionAnswers[customAnswer.answerIndex] = translatedAnswer;
        }
      }
    }
    output.metadata = { ...parsedMetadata.data, answers };
  }

  function selectModel(configuredSmallModel: unknown): MaybeUndefined<ModelReference> {
    const configured = z.string().safeParse(configuredSmallModel);
    const configuredReference = configured.success ? parseModelRef(configured.data) : undefined;
    const pluginModel =
      pluginOptions.model === undefined ? undefined : parseModelRef(pluginOptions.model);
    return pluginModel ?? configuredReference;
  }

  async function resolveModel(): Promise<MaybeUndefined<ModelReference>> {
    try {
      const response = await client.config.get({ query: { directory } });
      const parsedResponse = configResponseEnvelopeSchema.safeParse(response);
      if (!parsedResponse.success) return undefined;
      if (!("data" in parsedResponse.data)) return undefined;
      const parsedConfig = configResponseSchema.safeParse(parsedResponse.data.data);
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
    config: async (config) => {
      const translatorAgent = {
        hidden: true,
        mode: "subagent",
        prompt: "Translate the user's text only. Return only the translated text.",
        tools: { "*": false },
      } satisfies {
        hidden: boolean;
        mode: "subagent";
        prompt: string;
        tools: { "*": boolean };
      };
      config.agent = {
        ...config.agent,
        [TRANSLATOR_AGENT]: translatorAgent,
      };
    },
    "chat.message": async (input, output) => {
      if (!enabled || pluginOptions.input === "show original") return;
      if (translatorSessions.has(input.sessionID)) return;
      if (input.agent !== undefined)
        remember(sessionAgents, input.sessionID, input.agent, MAX_RETAINED_ENTRIES);
      if (isExcludedSession(input.sessionID)) return;
      const model = await resolveModel();
      if (model === undefined) return;
      for (const part of output.parts) {
        if (!isTranslatablePart(part)) continue;
        const original = part.text;
        if (extractTranslatedTranslation(original) !== undefined) continue;
        const translated = await getTranslation(
          original,
          model,
          `${model.providerID}/${model.modelID}:input:${part.id}:${original}`,
        );
        if (translated !== undefined)
          part.text = displayTranslation(original, translated, pluginOptions.input);
      }
    },
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
        await log("warn", "Translation is enabled but small_model is not configured");
        return;
      }
      const messages = parseMessages(output.messages);
      if (messages === undefined) return;
      for (const [index, message] of messages.entries()) {
        if (translatorSessions.has(message.info.sessionID)) continue;
        const outputMessage = output.messages[index];
        if (outputMessage === undefined) return;
        Object.assign(outputMessage, message);
        if (message.info.role === "assistant") {
          for (const part of message.parts) {
            if (!isTranslatablePart(part)) continue;
            const original = extractOriginalTranslation(part.text);
            if (original !== undefined) part.text = original;
          }
          continue;
        }
        if (message.info.agent !== undefined)
          remember(sessionAgents, message.info.sessionID, message.info.agent, MAX_RETAINED_ENTRIES);
        if (isExcludedSession(message.info.sessionID)) continue;
        if (message.info.role !== "user") continue;
        const pending = message.parts.filter(isTranslatablePart);
        const texts = pending.map((part) =>
          pluginOptions.input === "show original + translation"
            ? (extractTranslatedTranslation(part.text) ?? part.text)
            : part.text,
        );
        const translated = await getBatchTranslation(texts, model, "to-english");
        if (translated === undefined) {
          for (const part of pending) {
            const key = `${model.providerID}/${model.modelID}:${part.id}:${part.text}`;
            const fallback = await getTranslation(part.text, model, key);
            if (fallback !== undefined) part.text = fallback;
          }
          continue;
        }
        for (const [index, part] of pending.entries()) {
          const value = translated[index];
          if (value !== undefined) part.text = value;
        }
      }
    },
    "tool.execute.before": async (input, output) => {
      if (
        !enabled ||
        input.tool !== "question" ||
        translatorSessions.has(input.sessionID) ||
        isExcludedSession(input.sessionID)
      )
        return;
      const parsed = questionArgsSchema.safeParse(output.args);
      if (!parsed.success) return;
      const model = await resolveModel();
      if (model === undefined) return;
      try {
        const localized = await translateQuestionArgs(parsed.data, model);
        if (localized !== undefined) {
          output.args.questions = localized.questions;
          remember(
            questionTranslations,
            input.callID,
            {
              original: parsed.data,
              localized,
            },
            MAX_RETAINED_ENTRIES,
          );
        }
      } catch (error) {
        await log("warn", "Question translation failed", {
          error: String(error),
        });
      }
    },
    "tool.execute.after": async (input, output) => {
      if (input.tool !== "question") return;
      if (translatorSessions.has(input.sessionID)) return;
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
      if (!enabled || translatorSessions.has(input.sessionID) || isExcludedSession(input.sessionID))
        return;
      if (pluginOptions.output === "show original") return;
      if (hasDisplayedTranslation(output.text)) return;
      if (translatedParts.has(input.partID) || translatingParts.has(input.partID)) return;
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
        if (translated === undefined) {
          if (pluginOptions.show_translation_failures)
            output.text = displayTranslationFailure(original);
          return;
        }
        if (output.text !== original || hasDisplayedTranslation(output.text)) return;
        output.text = displayTranslation(original, translated, pluginOptions.output);
        rememberSet(translatedParts, input.partID, MAX_RETAINED_ENTRIES);
      } finally {
        translatingParts.delete(input.partID);
      }
    },
    "experimental.chat.system.transform": async (_input, output) => {
      if (!enabled) return;
      if (
        _input.sessionID !== undefined &&
        (translatorSessions.has(_input.sessionID) || isExcludedSession(_input.sessionID))
      )
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
