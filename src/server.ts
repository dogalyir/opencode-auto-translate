import type { Plugin } from "@opencode-ai/plugin";
import { z } from "zod";
import { loadPluginOptions } from "./config";
import {
  cleanTranslation,
  displayTranslation,
  hasDisplayedTranslation,
  isTranslatablePart,
  parseModelRef,
  parseToggleCommand,
  questionArgsSchema,
  TRANSLATION_AGENT,
  TRANSLATION_MODEL_INSTRUCTION,
  TRANSLATION_ID,
  translationPrompt,
  type ModelReference,
  type QuestionArgs,
} from "./translation";

const sessionIdSchema = z.string().min(1);
const textResponseSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});
const translationResponseSchema = z.object({ parts: z.array(z.unknown()) });
const configResponseSchema = z.object({ small_model: z.unknown().optional() }).passthrough();
const messagesSchema = z.array(
  z.object({
    info: z
      .object({ role: z.string(), sessionID: z.string().min(1) })
      .passthrough(),
    parts: z.array(z.record(z.string(), z.unknown())),
  }).passthrough(),
);
const questionAnswersSchema = z.object({
  answers: z.array(z.array(z.string())),
});

function extractTranslation(value: unknown): string | undefined {
  const parsed = translationResponseSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const textParts = parsed.data.parts.flatMap((part) => {
    const textPart = textResponseSchema.safeParse(part);
    return textPart.success ? [textPart.data.text] : [];
  });
  if (textParts.length === 0) return undefined;
  const cleaned = cleanTranslation(textParts.join("\n"));
  return cleaned.length > 0 ? cleaned : undefined;
}

type MessageList = z.infer<typeof messagesSchema>;
type QuestionTranslation = { original: QuestionArgs; localized: QuestionArgs };
type ToolOutput = { output: string; metadata: unknown };

function parseMessages(value: unknown): MessageList | undefined {
  const parsed = messagesSchema.safeParse(value);
  if (!parsed.success) return undefined;
  return parsed.data;
}

function parseQuestionArgsTranslation(value: string): QuestionArgs | undefined {
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
	  const inFlight = new Map<string, Promise<string | undefined>>();
	  const internalSessions = new Set<string>();
	  const translatingParts = new Set<string>();
  const translatedParts = new Set<string>();
  const questionTranslations = new Map<string, QuestionTranslation>();

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

  async function deleteSession(sessionID: string) {
    try {
      const response = await client.session.delete({
        path: { id: sessionID },
        query: { directory },
      });
      if (response.error)
        await log("warn", "Failed to delete temporary translation session", {
          sessionID,
        });
    } catch (error) {
      await log("warn", "Failed to delete temporary translation session", {
        sessionID,
        error: String(error),
      });
    }
  }

  async function translateText(
    text: string,
    model: ModelReference,
    direction: "to-english" | "from-english" = "to-english",
  ): Promise<string | undefined> {
    let sessionResponse;
    try {
      sessionResponse = await client.session.create({
        query: { directory },
        body: { title: "Auto-translate" },
      });
    } catch (error) {
      await log("error", "Failed to create translation session", {
        error: String(error),
      });
      return undefined;
    }
    if (sessionResponse.error) {
      await log("error", "Failed to create translation session", {
        error: String(sessionResponse.error),
      });
      return undefined;
    }
    const sessionData = sessionResponse.data;
    if (sessionData === undefined) {
      await log("error", "Translation session response did not include data");
      return undefined;
    }
    const sessionID = sessionIdSchema.safeParse(sessionData.id);
    if (!sessionID.success) {
      await log("error", "Translation session did not return a valid ID");
      return undefined;
    }
    internalSessions.add(sessionID.data);
    try {
      let response;
      try {
        response = await client.session.prompt({
          path: { id: sessionID.data },
          query: { directory },
          body: {
            model,
            ...(pluginOptions.variant === undefined
              ? {}
              : { variant: pluginOptions.variant }),
            agent: TRANSLATION_AGENT,
            system: TRANSLATION_MODEL_INSTRUCTION,
            tools: {},
            parts: [{
              type: "text",
              text: translationPrompt(text, direction, pluginOptions.lang),
            }],
          },
        });
      } catch (error) {
        await log("error", "Translation request failed", {
          error: String(error),
        });
        return undefined;
      }
      if (response.error) {
        await log("error", "Translation request failed", {
          error: String(response.error),
        });
        return undefined;
      }
      return extractTranslation(response.data);
    } finally {
      internalSessions.delete(sessionID.data);
      await deleteSession(sessionID.data);
    }
  }

  async function getTranslation(
    text: string,
    model: ModelReference,
    key: string,
    direction: "to-english" | "from-english" = "to-english",
  ) {
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const pending = inFlight.get(key);
    if (pending !== undefined) return pending;
    const request = translateText(text, model, direction);
    inFlight.set(key, request);
    let translated: string | undefined;
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
  ): Promise<QuestionArgs | undefined> {
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

    for (const [index, originalQuestion] of translation.original.questions.entries()) {
      const localizedQuestion = translation.localized.questions[index];
      if (localizedQuestion === undefined) continue;
      output.output = output.output.split(localizedQuestion.question).join(originalQuestion.question);
      output.output = output.output.split(localizedQuestion.header).join(originalQuestion.header);
      for (const [optionIndex, originalOption] of originalQuestion.options.entries()) {
        const localizedOption = localizedQuestion.options[optionIndex];
        if (localizedOption === undefined) continue;
        output.output = output.output.split(localizedOption.label).join(originalOption.label);
        output.output = output.output.split(localizedOption.description).join(originalOption.description);
      }
    }

    const parsedMetadata = questionAnswersSchema.safeParse(output.metadata);
    if (!parsedMetadata.success) return;
    const model = await resolveModel();
    const answers = await Promise.all(parsedMetadata.data.answers.map(async (questionAnswers, index) => {
      const originalQuestion = translation.original.questions[index];
      const localizedQuestion = translation.localized.questions[index];
      if (originalQuestion === undefined || localizedQuestion === undefined)
        return questionAnswers;
      return Promise.all(questionAnswers.map(async (answer) => {
        const optionIndex = localizedQuestion.options.findIndex((option) => option.label === answer);
        if (optionIndex >= 0) return originalQuestion.options[optionIndex]?.label ?? answer;
        if (model === undefined || answer === "Unanswered") return answer;
        return await getTranslation(
          answer,
          model,
          `${model.providerID}/${model.modelID}:question-answer:${callID}:${index}:${answer}`,
          "to-english",
        ) ?? answer;
      }));
    }));
    output.metadata = { ...parsedMetadata.data, answers };
  }

  function selectModel(configuredSmallModel: unknown): ModelReference | undefined {
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

  async function resolveModel(): Promise<ModelReference | undefined> {
    try {
      const response = await client.config.get({ query: { directory } });
      if (response.error || response.data === undefined) return undefined;
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
        if (
          message.info.role !== "user" ||
          internalSessions.has(message.info.sessionID)
        )
          continue;
        for (const part of message.parts) {
          if (!isTranslatablePart(part)) continue;
          const key = `${model.providerID}/${model.modelID}:${part.id}:${part.text}`;
          const translated = await getTranslation(part.text, model, key);
          if (translated !== undefined) part.text = translated;
        }
      }
    },
    "tool.execute.before": async (input, output) => {
      if (!enabled || input.tool !== "question") return;
      const parsed = questionArgsSchema.safeParse(output.args);
      if (!parsed.success) return;
      const model = await resolveModel();
      if (model === undefined) return;
      try {
        const localized = await translateQuestionArgs(parsed.data, model, input.callID);
        if (localized !== undefined) {
          output.args.questions = localized.questions;
          questionTranslations.set(input.callID, {
            original: parsed.data,
            localized,
          });
        }
      } catch (error) {
        await log("warn", "Question translation failed", { error: String(error) });
      }
    },
    "tool.execute.after": async (input, output) => {
      if (input.tool !== "question") return;
      try {
        await restoreQuestionResult(input.callID, output);
      } catch (error) {
        questionTranslations.delete(input.callID);
        await log("warn", "Question result restoration failed", { error: String(error) });
      }
    },
	    "experimental.text.complete": async (input, output) => {
	      if (!enabled || internalSessions.has(input.sessionID)) return;
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
	        const model = await resolveModel();
	        if (model === undefined || original.trim().length === 0) return;
	        const translated = await getTranslation(
	          original,
	          model,
	          `${model.providerID}/${model.modelID}:response:${input.partID}:${original}`,
          "from-english",
        );
        if (translated === undefined) return;
	        if (output.text !== original || hasDisplayedTranslation(output.text)) return;
        output.text = displayTranslation(original, translated, pluginOptions.output);
	        translatedParts.add(input.partID);
	      } finally {
	        translatingParts.delete(input.partID);
	      }
	    },
    "experimental.chat.system.transform": async (_input, output) => {
      if (!enabled) return;
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
