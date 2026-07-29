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
export const sessionPromptResponseSchema = z.object({
  info: z.object({ role: z.literal("assistant") }).passthrough(),
  parts: z.array(z.record(z.string(), z.unknown())),
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
