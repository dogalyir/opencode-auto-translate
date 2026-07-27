import { expect, test } from "bun:test";
import {
  isTranslatablePart,
  parseModelRef,
  pluginOptionsSchema,
  translationPrompt,
  displayTranslation,
} from "../src/translation";

const serverModule = await import("../src/server");

test("server entrypoint exports only the plugin factory", () => {
  expect(Object.keys(serverModule)).toEqual(["default"]);
});

test("parses model references with slash-containing model IDs", () => {
  expect(parseModelRef("openrouter/openai/gpt-4o-mini")).toEqual({
    providerID: "openrouter",
    modelID: "openai/gpt-4o-mini",
  });
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
  expect(displayTranslation("Hello", "Hola", "show translation")).toBe("Hello\n\nHola");
  expect(displayTranslation("Hello", "Hola", "show original + translation")).toBe("Hello\n\n[Translation]\nHola");
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
});

test("plugin replaces the original message with the translation", async () => {
  const createPlugin = Object.getOwnPropertyDescriptor(serverModule, "default")?.value;
  if (typeof createPlugin !== "function") throw new Error("Missing plugin factory");

  const translationRequest = async () => ({
    data: { parts: [{ type: "text", text: "hello" }] },
  });
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
      properties: { command: "opencode-auto-translate.toggle:on" },
    },
  }]);

  const output = {
    messages: [
      {
        info: { role: "user", sessionID: "user-session" },
        parts: [{ id: "part", type: "text", text: "hola" }],
      },
    ],
  };
  await Reflect.apply(transform, plugin, [{}, output]);

  expect(output.messages[0]?.parts[0]?.text).toBe("hello");
});
