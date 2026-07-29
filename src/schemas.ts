import { z } from "zod";

export const configResponseSchema = z.object({ small_model: z.unknown().optional() }).passthrough();
const providerModelSchema = z.object({
  id: z.string().optional(),
  api: z.object({ id: z.string().optional(), url: z.string().optional() }).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});
const providerSchema = z.object({
  id: z.string().min(1),
  env: z.array(z.string()),
  key: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  models: z.record(z.string(), providerModelSchema).optional(),
});
export const providerListSchema = z.object({ all: z.array(providerSchema) });
export const directTranslationResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.string().nullable() }),
    }),
  ),
});
export const messagesSchema = z.array(
  z
    .object({
      info: z
        .object({
          role: z.string(),
          sessionID: z.string().min(1),
          agent: z.string().min(1).optional(),
        })
        .passthrough(),
      parts: z.array(z.record(z.string(), z.unknown())),
    })
    .passthrough(),
);
export const questionAnswersSchema = z.object({
  answers: z.array(z.array(z.string())),
});
