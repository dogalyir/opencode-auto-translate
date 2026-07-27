import { z } from "zod";

export const TRANSLATION_EVENT = "opencode-auto-translate.toggle";
export const TRANSLATION_SERVICE = "opencode-auto-translate";
export const TRANSLATION_AGENT = "general";
export const TRANSLATION_MODEL_INSTRUCTION =
  "You are a precise translation engine. Translate text only.";
const TRANSLATION_SOURCE = "the source language";

export const pluginOptionsSchema = z.object({
  enabled: z.boolean().optional(),
  model: z.string().optional(),
  variant: z.string().trim().min(1).optional(),
  lang: z.string().trim().min(1).default("English"),
  input: z
    .enum(["show original", "show translation", "show original + translation"])
    .default("show original"),
  output: z
    .enum(["show original", "show translation", "show original + translation"])
    .default("show original"),
  small_model: z.string().optional(),
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
  if (mode === "show translation") return `${original}\n\n${translated}`;
  return `${original}\n\n[Translation]\n${translated}`;
}

export function parseToggleCommand(command: string): boolean | undefined {
  if (command === `${TRANSLATION_EVENT}:on`) return true;
  if (command === `${TRANSLATION_EVENT}:off`) return false;
  return undefined;
}
