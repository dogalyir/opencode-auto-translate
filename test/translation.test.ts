import { expect, test } from "bun:test"
import { isTranslatablePart, parseModelRef, pluginOptionsSchema, translationPrompt } from "../src/translation"

test("parses model references with slash-containing model IDs", () => {
  expect(parseModelRef("openrouter/openai/gpt-4o-mini")).toEqual({
    providerID: "openrouter",
    modelID: "openai/gpt-4o-mini",
  })
})

test("rejects malformed model references", () => {
  expect(parseModelRef("openai")).toBeUndefined()
  expect(parseModelRef("/model")).toBeUndefined()
})

test("only translates non-synthetic text parts", () => {
  expect(isTranslatablePart({ id: "part", type: "text", text: "Hola" })).toBe(true)
  expect(isTranslatablePart({ id: "part", type: "text", text: "Hola", synthetic: true })).toBe(false)
  expect(isTranslatablePart({ id: "part", type: "file", text: "Hola" })).toBe(false)
  expect(isTranslatablePart({ id: "part", type: "text", text: "   " })).toBe(false)
})

test("translation prompt requests output without commentary", () => {
  const prompt = translationPrompt("Hola **mundo**")
  expect(prompt).toContain("Return only the translation")
  expect(prompt).toContain("Hola **mundo**")
})

test("translation prompt supports translating the response back to the configured language", () => {
  const prompt = translationPrompt("Hello **world**", "from-english", "Spanish")
  expect(prompt).toContain("from English to Spanish")
  expect(prompt).toContain("Hello **world**")
})

test("plugin options provide strict defaults and accept model display settings", () => {
  expect(pluginOptionsSchema.parse({})).toMatchObject({
    lang: "English",
    input: "show original",
    output: "show original",
  })
  expect(pluginOptionsSchema.parse({
    model: "openai/gpt-5.4-mini",
    variant: "minimal",
    lang: "Spanish",
    input: "show original + translation",
    output: "append translation",
  })).toMatchObject({ model: "openai/gpt-5.4-mini", variant: "minimal", lang: "Spanish" })
})
