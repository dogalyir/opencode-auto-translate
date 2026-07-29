import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPluginOptions } from "../src/config";
import {
  isTranslatablePart,
  parseModelRef,
  pluginOptionsSchema,
  TRANSLATION_EVENT,
  parseToggleCommand,
  translationPrompt,
  displayTranslation,
  hasDisplayedTranslation,
} from "../src/translation";

const serverModule = await import("../src/server");

function getPluginFactory(): (...args: never[]) => unknown {
  const pluginDescriptor = Object.getOwnPropertyDescriptor(serverModule, "default");
  if (pluginDescriptor === undefined) throw new Error("Missing plugin factory");
  const createPlugin = pluginDescriptor.value;
  if (typeof createPlugin !== "function") throw new Error("Missing plugin factory");
  return createPlugin;
}

function createTranslationClient(prompt: () => Promise<unknown>) {
  return {
    app: { log: async () => ({}) },
    config: { get: async () => ({ data: { small_model: "openai/model" } }) },
    session: {
      create: async () => ({ data: { id: "translation-session" } }),
      prompt,
      delete: async () => ({}),
    },
  };
}

test("server entrypoint exports only the plugin factory", () => {
  expect(Object.keys(serverModule)).toEqual(["default"]);
});

test("parses model references with slash-containing model IDs", () => {
  expect(parseModelRef("openrouter/openai/gpt-4o-mini")).toEqual({
    providerID: "openrouter",
    modelID: "openai/gpt-4o-mini",
  });
});

test("parses toggle commands explicitly", () => {
  expect(parseToggleCommand(`${TRANSLATION_EVENT}:on`)).toBe(true);
  expect(parseToggleCommand(`${TRANSLATION_EVENT}:off`)).toBe(false);
  expect(parseToggleCommand(`${TRANSLATION_EVENT}:unknown`)).toBeUndefined();
});

test("rejects malformed model references", () => {
  expect(parseModelRef("openai")).toBeUndefined();
  expect(parseModelRef("/model")).toBeUndefined();
});

test("only translates non-synthetic text parts", () => {
  expect(isTranslatablePart({ id: "part", type: "text", text: "Hola" })).toBe(
    true,
  );
  expect(
    isTranslatablePart({
      id: "part",
      type: "text",
      text: "Hola",
      synthetic: true,
    }),
  ).toBe(false);
  expect(isTranslatablePart({ id: "part", type: "file", text: "Hola" })).toBe(
    false,
  );
  expect(isTranslatablePart({ id: "part", type: "text", text: "   " })).toBe(
    false,
  );
});

test("translation prompt requests output without commentary", () => {
  const prompt = translationPrompt("Hola **mundo**");
  expect(prompt).toContain("Return only the translation");
  expect(prompt).toContain("Hola **mundo**");
});

test("translation prompt supports translating the response back to the configured language", () => {
  const prompt = translationPrompt(
    "Hello **world**",
    "from-english",
    "Spanish",
  );
  expect(prompt).toContain("from English to Spanish");
  expect(prompt).toContain("Hello **world**");
});

test("display modes preserve English context", () => {
  expect(displayTranslation("Hello", "Hola", "show original")).toBe("Hello");
  expect(displayTranslation("Hello", "Hola", "show translation")).toBe(
    "Hello\n\n----------------------------------------\n[Translation]\nHola",
  );
  expect(displayTranslation("Hello", "Hola", "show original + translation")).toBe(
    "Hello\n\n----------------------------------------\n[Translation]\nHola",
  );
});

test("detects the canonical displayed translation block", () => {
  const displayed = displayTranslation("Hello", "Hola", "show translation");
  expect(hasDisplayedTranslation(displayed)).toBe(true);
  expect(hasDisplayedTranslation("Hello\n\n----------------------------------------\n[Other]\nHola")).toBe(false);
});

test("plugin options provide strict defaults and accept model display settings", () => {
  expect(pluginOptionsSchema.parse({})).toMatchObject({
    lang: "English",
    input: "show original",
    output: "show original",
  });
  expect(
    pluginOptionsSchema.parse({
      model: "openai/gpt-5.4-mini",
      variant: "minimal",
      lang: "Spanish",
      input: "show original + translation",
      output: "show original + translation",
    }),
  ).toMatchObject({
    model: "openai/gpt-5.4-mini",
    variant: "minimal",
    lang: "Spanish",
  });
  expect(pluginOptionsSchema.parse({ small_model: "openai/legacy" })).not.toHaveProperty(
    "small_model",
  );
});

test("shared config is loaded before inline options", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-translate-"));
  const previousDirectory = process.env["OPENCODE_CONFIG_DIR"];
  try {
    process.env["OPENCODE_CONFIG_DIR"] = directory;
    await writeFile(
      join(directory, "translate.json"),
      JSON.stringify({ lang: "Spanish", output: "show translation", model: "openai/from-file" }),
    );
    await expect(loadPluginOptions({ lang: "French", model: "openai/from-inline" })).resolves.toMatchObject({
      lang: "French",
      output: "show translation",
      model: "openai/from-inline",
    });
  } finally {
    if (previousDirectory === undefined) delete process.env["OPENCODE_CONFIG_DIR"];
    else process.env["OPENCODE_CONFIG_DIR"] = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});

test("plugin replaces the original message with the translation", async () => {
  const createPlugin = getPluginFactory();
  let requestedModel: unknown;

  const translationRequest = async (request: { body: { model: unknown } }) => {
    requestedModel = request.body.model;
    return { data: { parts: [{ type: "text", text: "hello" }] } };
  };
  const client = {
    app: { log: async () => ({}) },
    config: { get: async () => ({ data: { small_model: "openai/gpt-5.6-luna" } }) },
    session: {
      create: async () => ({ data: { id: "translation-session" } }),
      prompt: translationRequest,
      delete: async () => ({}),
    },
  };
  const plugin = await Reflect.apply(createPlugin, undefined, [
    { client, directory: "/tmp" },
    {
      output: "show original + translation",
      lang: "Spanish",
      model: "openai/override",
    },
  ]);
  if (plugin === null || (typeof plugin !== "object" && typeof plugin !== "function"))
    throw new Error("Invalid plugin hooks");
  const event = Reflect.get(plugin, "event");
  const transform = Reflect.get(plugin, "experimental.chat.messages.transform");
  if (typeof event !== "function" || typeof transform !== "function")
    throw new Error("Missing plugin hooks");

  await Reflect.apply(event, plugin, [{
    event: {
      type: "tui.command.execute",
      properties: { command: `${TRANSLATION_EVENT}:on` },
    },
  }]);

  const output = {
    messages: [
      {
        info: {
          role: "user",
          sessionID: "user-session",
          id: "message-id",
          metadata: { source: "test" },
        },
        parts: [{
          id: "part",
          type: "text",
          text: "hola",
          metadata: { source: "test" },
        }],
      },
    ],
  };
  await Reflect.apply(transform, plugin, [{}, output]);

  const firstMessage = output.messages[0];
  if (firstMessage === undefined) throw new Error("Missing translated message");
  const firstPart = firstMessage.parts[0];
  if (firstPart === undefined) throw new Error("Missing translated part");
  expect(firstPart.text).toBe("hello");
  expect(requestedModel).toEqual({ providerID: "openai", modelID: "override" });
  expect(firstMessage.info.id).toBe("message-id");
  expect(firstMessage.info.metadata).toEqual({ source: "test" });
  expect(firstPart.metadata).toEqual({ source: "test" });
  const responseTransform = Reflect.get(plugin, "experimental.text.complete");
  if (typeof responseTransform !== "function") throw new Error("Missing text transform");
  const response = { text: "hello" };
  const responseInput = { sessionID: "user-session", partID: "response-part" };
  await Reflect.apply(responseTransform, plugin, [responseInput, response]);
  await Reflect.apply(responseTransform, plugin, [responseInput, response]);
  expect(response.text).toBe("hello\n\n----------------------------------------\n[Translation]\nhello");
});

test("plugin does not append duplicate translations for concurrent completion hooks", async () => {
  const createPlugin = getPluginFactory();
  let releaseTranslation: (() => void) | undefined;
  const translationStarted = new Promise<void>((resolve) => {
    releaseTranslation = resolve;
  });
  const client = createTranslationClient(async () => {
    await translationStarted;
    return { data: { parts: [{ type: "text", text: "hola" }] } };
  });
  const plugin = await Reflect.apply(createPlugin, undefined, [
    { client, directory: "/tmp" },
    { enabled: true, output: "show translation", lang: "Spanish" },
  ]);
  if (plugin === null || typeof plugin !== "object") throw new Error("Invalid plugin hooks");
  const responseTransform = Reflect.get(plugin, "experimental.text.complete");
  if (typeof responseTransform !== "function") throw new Error("Missing text transform");

  const firstResponse = { text: "hello" };
  const secondResponse = { text: "hello" };
  const input = { sessionID: "user-session", partID: "response-part" };
  const first = Reflect.apply(responseTransform, plugin, [input, firstResponse]);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const second = Reflect.apply(responseTransform, plugin, [input, secondResponse]);
  releaseTranslation?.();
  await Promise.all([first, second]);

  expect(firstResponse.text).toBe("hello\n\n----------------------------------------\n[Translation]\nhola");
  expect(secondResponse.text).toBe("hello");
});

test("plugin instances do not append duplicate response translations", async () => {
  const createPlugin = getPluginFactory();
  const client = createTranslationClient(async () => ({
    data: { parts: [{ type: "text", text: "hola" }] },
  }));
  const firstPlugin = await Reflect.apply(createPlugin, undefined, [
    { client, directory: "/tmp" },
    { enabled: true, output: "show translation", lang: "Spanish" },
  ]);
  const secondPlugin = await Reflect.apply(createPlugin, undefined, [
    { client, directory: "/tmp" },
    { enabled: true, output: "show translation", lang: "Spanish" },
  ]);
  if (firstPlugin === null || typeof firstPlugin !== "object") throw new Error("Invalid first plugin");
  if (secondPlugin === null || typeof secondPlugin !== "object") throw new Error("Invalid second plugin");
  const firstTransform = Reflect.get(firstPlugin, "experimental.text.complete");
  const secondTransform = Reflect.get(secondPlugin, "experimental.text.complete");
  if (typeof firstTransform !== "function" || typeof secondTransform !== "function")
    throw new Error("Missing text transform");

  const response = { text: "hello" };
  const input = { sessionID: "user-session", partID: "response-part" };
  await Reflect.apply(firstTransform, firstPlugin, [input, response]);
  await Reflect.apply(secondTransform, secondPlugin, [input, response]);

  expect(response.text).toBe("hello\n\n----------------------------------------\n[Translation]\nhola");
});

test("translation hooks fail open when configuration response is malformed", async () => {
  const createPlugin = getPluginFactory();
  let sessionCreates = 0;
  const client = {
    app: { log: async () => ({}) },
    config: { get: async () => ({ data: { small_model: 42 } }) },
    session: {
      create: async () => {
        sessionCreates += 1;
        return { data: { id: "unexpected" } };
      },
    },
  };
  const plugin = await Reflect.apply(createPlugin, undefined, [
    { client, directory: "/tmp" },
    { enabled: true },
  ]);
  if (plugin === null || typeof plugin !== "object") throw new Error("Invalid plugin hooks");
  const transform = Reflect.get(plugin, "experimental.chat.messages.transform");
  if (typeof transform !== "function") throw new Error("Missing message transform");
  const output = {
    messages: [{
      info: { role: "user", sessionID: "session" },
      parts: [{ id: "part", type: "text", text: "hola" }],
    }],
  };
  await Reflect.apply(transform, plugin, [{}, output]);
  const firstMessage = output.messages[0];
  if (firstMessage === undefined) throw new Error("Missing message");
  const firstPart = firstMessage.parts[0];
  if (firstPart === undefined) throw new Error("Missing part");
  expect(firstPart.text).toBe("hola");
  expect(sessionCreates).toBe(0);
});

test("translation hooks fail open when configuration lookup throws", async () => {
  const createPlugin = getPluginFactory();
  const client = {
    app: { log: async () => ({}) },
    config: { get: async () => { throw new Error("configuration unavailable"); } },
    session: {
      create: async () => ({ data: { id: "unused" } }),
      prompt: async () => ({ data: { parts: [] } }),
      delete: async () => ({}),
    },
  };
  const plugin = await Reflect.apply(createPlugin, undefined, [
    { client, directory: "/tmp" },
    { enabled: true, output: "show translation" },
  ]);
  if (plugin === null || (typeof plugin !== "object" && typeof plugin !== "function"))
    throw new Error("Invalid plugin hooks");
  const messageTransform = Reflect.get(plugin, "experimental.chat.messages.transform");
  const responseTransform = Reflect.get(plugin, "experimental.text.complete");
  if (typeof messageTransform !== "function" || typeof responseTransform !== "function")
    throw new Error("Missing plugin hooks");
  const output = { messages: [] };
  const response = { text: "hello" };
  await Reflect.apply(messageTransform, plugin, [{}, output]);
  await Reflect.apply(responseTransform, plugin, [{ partID: "part", sessionID: "session" }, response]);
  expect(response.text).toBe("hello");
});
