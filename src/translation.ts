import { z } from "zod";

export const TRANSLATION_ID = "opencode-auto-translate";
export const TRANSLATION_EVENT = `${TRANSLATION_ID}.toggle`;
const DISPLAY_MODES = ["show original", "show translation", "show original + translation"] as const;
const TRANSLATION_SEPARATOR = "----------------------------------------";
const TRANSLATION_MARKER = `${TRANSLATION_SEPARATOR}\n[Translation]\n`;
export const TRANSLATION_AGENT = "general";
export const TRANSLATION_MODEL_INSTRUCTION =
  "You are a precise translation engine. Translate text only.";
const TRANSLATION_SOURCE = "the source language";

export const pluginOptionsSchema = z.object({
  enabled: z.boolean().optional().meta({ description: "Enable or disable automatic translation." }),
  model: z.string().optional().meta({ description: "Translation model in provider/model format." }),
  variant: z.string().trim().min(1).optional().meta({ description: "Optional provider-specific model variant." }),
  lang: z.string().trim().min(1).default("English").meta({ description: "Language used for translating assistant responses." }),
  input: z.enum(DISPLAY_MODES).default("show original").meta({ description: "How translated user prompts are displayed." }),
  output: z.enum(DISPLAY_MODES).default("show original").meta({ description: "How translated assistant responses are displayed." }),
}).meta({
  title: "OpenCode Auto Translate configuration",
  description: "Global configuration for the opencode-auto-translate plugin.",
});

const modelReferenceSchema = z.object({
  providerID: z.string().trim().min(1),
  modelID: z.string().trim().min(1),
});

const translationPartSchema = z.object({
  id: z.string().min(1),
  type: z.literal("text"),
  text: z.string(),
  synthetic: z.boolean().optional(),
  ignored: z.boolean().optional(),
});

const questionOptionSchema = z.object({
  label: z.string(),
  description: z.string(),
});
const questionPromptSchema = z.object({
  question: z.string(),
  header: z.string(),
  options: z.array(questionOptionSchema),
  multiple: z.boolean().optional(),
});
export const questionArgsSchema = z.object({
  questions: z.array(questionPromptSchema),
});
export type QuestionArgs = z.infer<typeof questionArgsSchema>;

export type ModelReference = z.infer<typeof modelReferenceSchema>;
export type PluginOptions = z.infer<typeof pluginOptionsSchema>;
export type TranslationPart = z.infer<typeof translationPartSchema>;
export type TranslationDirection = "to-english" | "from-english";

export function parseModelRef(value: string): ModelReference | undefined {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) return undefined;
  const parsed = modelReferenceSchema.safeParse({
    providerID: value.slice(0, separator),
    modelID: value.slice(separator + 1),
  });
  return parsed.success ? parsed.data : undefined;
}

export function isTranslatablePart(value: unknown): value is TranslationPart {
  const parsed = translationPartSchema.safeParse(value);
  if (!parsed.success) return false;
  if (parsed.data.synthetic === true || parsed.data.ignored === true)
    return false;
  return parsed.data.text.trim().length > 0;
}

export function translationPrompt(
  text: string,
  direction: TranslationDirection = "to-english",
  language = "English",
) {
  const target = direction === "to-english" ? "English" : language;
  const source = direction === "to-english" ? TRANSLATION_SOURCE : "English";
  return [
    `Translate the following text from ${source} to ${target}.`,
    "Preserve meaning, formatting, Markdown, code, URLs, filenames, commands, and placeholders exactly.",
    "Return only the translation. Do not explain, summarize, quote, or add commentary.",
    "<user-message>",
    text,
    "</user-message>",
  ].join("\n");
}

export function cleanTranslation(text: string): string {
  const cleaned = text
    .replace(/^```(?:text|english)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
  return cleaned;
}

export function displayTranslation(
  original: string,
  translated: string,
  mode: PluginOptions["output"],
): string {
  if (mode === "show original") return original;
  return `${original}\n\n${TRANSLATION_MARKER}${translated}`;
}

export function hasDisplayedTranslation(text: string): boolean {
  return text.includes(`\n\n${TRANSLATION_MARKER}`);
}

export function parseToggleCommand(command: string): boolean | undefined {
  if (command === `${TRANSLATION_EVENT}:on`) return true;
  if (command === `${TRANSLATION_EVENT}:off`) return false;
  return undefined;
}
