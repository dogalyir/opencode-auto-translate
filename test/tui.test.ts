import { expect, test } from "bun:test";
import { tuiPublishResponseSchema } from "../src/schemas";
import type { MaybeUndefined } from "../src/types";

const tuiModule = await import("../src/tui");

function createTuiApi(storedValue: unknown) {
  const published: string[] = [];
  const layers: Array<{ commands?: Array<{ run?: () => Promise<void> }> }> = [];
  let slotRenderer: MaybeUndefined<() => unknown>;
  const api = {
    kv: { get: () => storedValue, set: () => undefined },
    ui: { toast: () => undefined },
    client: {
      tui: {
        publish: async ({ body }: { body: { properties: { command: string } } }) => {
          published.push(body.properties.command);
          return { data: true };
        },
      },
    },
    keymap: {
      registerLayer: (layer: { commands?: Array<{ run?: () => Promise<void> }> }) =>
        layers.push(layer),
    },
    slots: {
      register: (registration: { slots: { session_prompt_right: () => unknown } }) => {
        slotRenderer = registration.slots.session_prompt_right;
      },
    },
  };
  return { api, layers, published, getSlotRenderer: () => slotRenderer };
}

test("TUI publish responses require an explicit success or error state", () => {
  expect(tuiPublishResponseSchema.safeParse({ data: true }).success).toBe(true);
  expect(tuiPublishResponseSchema.safeParse({ error: "rejected" }).success).toBe(true);
  expect(tuiPublishResponseSchema.safeParse({}).success).toBe(false);
  expect(tuiPublishResponseSchema.safeParse({ data: true, error: "rejected" }).success).toBe(false);
  expect(tuiPublishResponseSchema.safeParse({ data: "true" }).success).toBe(false);
});

test("TUI initializes with invalid options and uses the safe language fallback", async () => {
  const { api, layers, published, getSlotRenderer } = createTuiApi(false);
  const plugin = tuiModule.default;
  await Reflect.apply(plugin.tui, undefined, [api, "/tmp", { lang: 42 }]);
  expect(layers.length).toBe(2);
  const firstLayer = layers[0];
  if (firstLayer === undefined || firstLayer.commands === undefined)
    throw new Error("Missing command layer");
  const command = firstLayer.commands[0];
  if (command === undefined || command.run === undefined) throw new Error("Missing toggle command");
  expect(typeof command.run).toBe("function");
  const publishPromise = command.run();
  await publishPromise;
  expect(published).toEqual([
    "opencode-auto-translate.toggle:off",
    "opencode-auto-translate.toggle:on",
  ]);
  const slotRenderer = getSlotRenderer();
  if (slotRenderer === undefined) throw new Error("Missing status slot");
  expect(typeof slotRenderer).toBe("function");
});

test("TUI uses the configured enabled state when no toggle state is persisted", async () => {
  const { api, published } = createTuiApi(undefined);

  await Reflect.apply(tuiModule.default.tui, undefined, [api, "/tmp", { enabled: true }]);

  expect(published).toEqual(["opencode-auto-translate.toggle:on"]);
});

test("TUI bundle keeps Solid as a host dependency", async () => {
  const packageText = await Bun.file("package.json").text();
  expect(packageText).toContain("--external 'solid-js'");
  expect(packageText).toContain('"solid-js": "1.9.12"');
});
