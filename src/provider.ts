import { z } from "zod";
import { directTranslationResponseSchema, providerListSchema } from "./schemas";
import {
  cleanTranslation,
  translationSystemPrompt,
  type ModelReference,
  type TranslationDirection,
} from "./translation";
import type { MaybeUndefined } from "./types";

const PROVIDER_BASE_URL_KEY = "baseURL";
const PROVIDER_HEADERS_KEY = "headers";
const CHAT_COMPLETIONS_PATH = "/chat/completions";
const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key";
const REQUEST_TIMEOUT_MS = 180_000;
const providerOptionsSchema = z.record(z.string(), z.unknown());

type ProviderLog = (
  level: "warn" | "error",
  message: string,
  extra?: Record<string, unknown>,
) => Promise<void>;
type ProviderList = () => Promise<{ error?: unknown; data?: unknown }>;

function extractTranslation(value: unknown): MaybeUndefined<string> {
  const parsed = directTranslationResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.choices.length === 0) return undefined;
  const choice = parsed.data.choices[0];
  if (choice === undefined || choice.message.content === null) return undefined;
  const cleaned = cleanTranslation(choice.message.content);
  return cleaned.length === 0 ? undefined : cleaned;
}

export function createDirectTranslator(
  listProviders: ProviderList,
  log: ProviderLog,
  language: string,
  variant: MaybeUndefined<string>,
): (
  text: string,
  model: ModelReference,
  direction: TranslationDirection,
) => Promise<MaybeUndefined<string>> {
  return async (text, model, direction) => {
    let providerResponse: { error?: unknown; data?: unknown };
    try {
      providerResponse = await listProviders();
    } catch (error) {
      await log("error", "Could not read OpenCode provider metadata", {
        error: String(error),
      });
      return undefined;
    }
    if (
      providerResponse.error !== undefined ||
      providerResponse.data === undefined
    ) {
      await log("warn", "Provider metadata was unavailable", {
        provider: model.providerID,
      });
      return undefined;
    }
    const parsedProviders = providerListSchema.safeParse(providerResponse.data);
    if (!parsedProviders.success) {
      await log("warn", "Provider metadata was malformed", {
        provider: model.providerID,
      });
      return undefined;
    }
    const provider = parsedProviders.data.all.find(
      (item) => item.id === model.providerID,
    );
    if (provider === undefined) {
      await log("warn", "Configured translation provider was not found", {
        provider: model.providerID,
      });
      return undefined;
    }
    const modelInfo = (provider.models ?? {})[model.modelID];
    const providerOptions = provider.options ?? {};
    const modelApi = modelInfo === undefined ? undefined : modelInfo.api;
    const providerBaseURL = providerOptions[PROVIDER_BASE_URL_KEY];
    const modelURL = modelApi === undefined ? undefined : modelApi.url;
    const providerURL =
      typeof providerBaseURL === "string" ? providerBaseURL : modelURL;
    if (providerURL === undefined || providerURL.trim().length === 0) {
      await log("warn", "Translation provider has no usable endpoint", {
        provider: model.providerID,
      });
      return undefined;
    }
    const normalizedURL = providerURL.replace(/\/+$/, "");
    const endpoint = normalizedURL.endsWith(CHAT_COMPLETIONS_PATH)
      ? normalizedURL
      : `${normalizedURL}${CHAT_COMPLETIONS_PATH}`;
    const configuredKey =
      provider.key === undefined ? undefined : provider.key.trim();
    const environmentKey = provider.env
      .map((name) => process.env[name])
      .find((value) => value !== undefined && value.trim().length > 0);
    const apiKey =
      configuredKey === undefined ||
      configuredKey === "" ||
      configuredKey === OAUTH_DUMMY_KEY
        ? environmentKey
        : configuredKey;
    const headers = new Headers({ "Content-Type": "application/json" });
    if (apiKey !== undefined) headers.set("Authorization", `Bearer ${apiKey}`);
    const providerHeaders = providerOptions[PROVIDER_HEADERS_KEY];
    const parsedHeaders = providerOptionsSchema.safeParse(providerHeaders);
    if (parsedHeaders.success) {
      for (const [name, value] of Object.entries(parsedHeaders.data)) {
        if (typeof value === "string") headers.set(name, value);
      }
    }
    const modelHeaders =
      modelInfo === undefined ? undefined : modelInfo.headers;
    if (modelHeaders !== undefined) {
      for (const [name, value] of Object.entries(modelHeaders))
        headers.set(name, value);
    }
    const modelAPIId = modelApi === undefined ? undefined : modelApi.id;
    const modelID = modelInfo === undefined ? undefined : modelInfo.id;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          model: modelAPIId ?? modelID ?? model.modelID,
          messages: [
            {
              role: "system",
              content: translationSystemPrompt(direction, language),
            },
            {
              role: "user",
              content: text,
            },
          ],
          stream: false,
          ...(variant === undefined ? {} : { variant }),
        }),
      });
      if (!response.ok) {
        await log("error", "Direct translation request failed", {
          status: response.status,
          provider: model.providerID,
        });
        return undefined;
      }
      return extractTranslation(await response.json());
    } catch (error) {
      await log("error", "Direct translation request failed", {
        error: String(error),
      });
      return undefined;
    }
  };
}
