import { z } from "zod";

function responseEnvelopeSchema<T extends z.ZodType>(dataSchema: T) {
  return z
    .union([
      z.object({ data: dataSchema }).passthrough(),
      z.object({ error: z.unknown() }).passthrough(),
    ])
    .refine(
      (value) => !("data" in value && "error" in value && value.error !== undefined),
      "Response cannot contain both data and error",
    );
}

export const configResponseEnvelopeSchema = responseEnvelopeSchema(z.unknown());
export const configResponseSchema = z.object({ small_model: z.unknown().optional() }).passthrough();
export const tuiPublishResponseSchema = responseEnvelopeSchema(z.boolean());
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
export const providerResponseSchema = responseEnvelopeSchema(z.record(z.string(), z.unknown()));
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
