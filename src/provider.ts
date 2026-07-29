import { z } from "zod";
import { sessionPromptResponseSchema } from "./schemas";
import {
  cleanTranslation,
  translationSystemPrompt,
  type ModelReference,
  type TranslationDirection,
} from "./translation";
import type { MaybeUndefined } from "./types";

export const TRANSLATOR_AGENT = "opencode-auto-translate-internal";

type SessionClient = {
  session: {
    create: (options: {
      query: { directory: string };
      body: { title: string };
    }) => Promise<unknown>;
    prompt: (options: {
      path: { id: string };
      query: { directory: string };
      body: {
        agent: string;
        model: ModelReference;
        system: string;
        tools: { "*": false };
        parts: [{ type: "text"; text: string }];
      };
    }) => Promise<unknown>;
    delete: (options: { path: { id: string }; query: { directory: string } }) => Promise<unknown>;
  };
};

type TranslatorLog = (
  level: "warn" | "error",
  message: string,
  extra?: Record<string, unknown>,
) => Promise<void>;

function extractTranslation(value: unknown): MaybeUndefined<string> {
  const parsed = z.object({ data: sessionPromptResponseSchema }).safeParse(value);
  if (!parsed.success) return undefined;
  for (const part of parsed.data.data.parts) {
    const textPart = z.object({ type: z.literal("text"), text: z.string() }).safeParse(part);
    if (!textPart.success) continue;
    const cleaned = cleanTranslation(textPart.data.text);
    if (cleaned.length > 0) return cleaned;
  }
  return undefined;
}

export function createSessionTranslator(
  client: SessionClient,
  directory: string,
  language: string,
  log: TranslatorLog,
  translatorSessions: Set<string>,
): (
  text: string,
  model: ModelReference,
  direction: TranslationDirection,
) => Promise<MaybeUndefined<string>> {
  return async (text, model, direction) => {
    let sessionID: string | undefined;
    try {
      const created = await client.session.create({
        query: { directory },
        body: { title: "Auto-translation" },
      });
      const session = z.object({ data: z.object({ id: z.string().min(1) }) }).safeParse(created);
      if (!session.success) {
        await log("warn", "Translation session response was malformed");
        return undefined;
      }
      sessionID = session.data.data.id;
      translatorSessions.add(sessionID);
      const response = await client.session.prompt({
        path: { id: sessionID },
        query: { directory },
        body: {
          agent: TRANSLATOR_AGENT,
          model,
          system: translationSystemPrompt(direction, language),
          tools: { "*": false },
          parts: [{ type: "text", text }],
        },
      });
      return extractTranslation(response);
    } catch (error) {
      await log("warn", "Translation session failed", { error: String(error) });
      return undefined;
    } finally {
      if (sessionID !== undefined) {
        translatorSessions.delete(sessionID);
        try {
          await client.session.delete({ path: { id: sessionID }, query: { directory } });
        } catch (error) {
          await log("warn", "Could not delete translation session", { error: String(error) });
        }
      }
    }
  };
}
