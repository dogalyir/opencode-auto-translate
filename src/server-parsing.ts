import { z } from "zod";
import { messagesSchema } from "./schemas";
import type { MaybeUndefined } from "./types";

export type MessageList = z.infer<typeof messagesSchema>;

export function parseMessages(value: unknown): MaybeUndefined<MessageList> {
  const parsed = messagesSchema.safeParse(value);
  if (!parsed.success) return undefined;
  return parsed.data;
}
