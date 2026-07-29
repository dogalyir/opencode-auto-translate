import { afterEach, beforeEach, expect, test } from "bun:test";
import { createDirectTranslator } from "../src/provider";
import type { ModelReference } from "../src/translation";

const model: ModelReference = { providerID: "provider", modelID: "model" };
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createTranslator(providerData: unknown, response: Response | Error) {
  const logs: string[] = [];
  const translator = createDirectTranslator(
    async () => ({ data: providerData }),
    async (_level, message) => {
      logs.push(message);
    },
    "English",
    undefined,
  );
  globalThis.fetch = Object.assign(
    async () => {
      if (response instanceof Error) throw response;
      return response;
    },
    { preconnect: originalFetch.preconnect },
  );
  return { logs, translator };
}

test("provider transport logs malformed metadata and fails open", async () => {
  const { logs, translator } = createTranslator(
    { all: "invalid" },
    new Response(),
  );
  expect(await translator("hola", model, "to-english")).toBeUndefined();
  expect(logs).toEqual(["Provider metadata was malformed"]);
});

test("provider transport logs missing endpoints and fails open", async () => {
  const providerData = {
    all: [{ id: "provider", env: [], models: { model: {} } }],
  };
  const { logs, translator } = createTranslator(providerData, new Response());
  expect(await translator("hola", model, "to-english")).toBeUndefined();
  expect(logs).toEqual(["Translation provider has no usable endpoint"]);
});

test("provider transport logs HTTP failures and network errors", async () => {
  const providerData = {
    all: [
      {
        id: "provider",
        env: [],
        models: { model: { api: { url: "https://example.test" } } },
      },
    ],
  };
  const failed = createTranslator(
    providerData,
    new Response("no", { status: 503 }),
  );
  expect(await failed.translator("hola", model, "to-english")).toBeUndefined();
  expect(failed.logs).toEqual(["Direct translation request failed"]);
  const network = createTranslator(providerData, new Error("offline"));
  expect(await network.translator("hola", model, "to-english")).toBeUndefined();
  expect(network.logs).toEqual(["Direct translation request failed"]);
});
