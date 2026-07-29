import { z } from "zod";
import { messagesSchema } from "./schemas";
import { questionArgsSchema, type QuestionArgs } from "./translation";
import type { MaybeUndefined } from "./types";

export type MessageList = z.infer<typeof messagesSchema>;

export function parseMessages(value: unknown): MaybeUndefined<MessageList> {
  const parsed = messagesSchema.safeParse(value);
  if (!parsed.success) return undefined;
  return parsed.data;
}

export function parseQuestionArgsTranslation(value: string): MaybeUndefined<QuestionArgs> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch (error) {
    console.warn("Could not parse translated question arguments", String(error));
    return undefined;
  }
  const parsed = questionArgsSchema.safeParse(decoded);
  if (!parsed.success) return undefined;
  return parsed.data;
}
