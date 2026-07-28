import { expect, test } from "bun:test"

const tuiModule = await import("../src/tui");

test("TUI initializes with invalid options and uses the safe language fallback", async () => {
  const layers: Array<{ commands?: Array<{ run?: () => Promise<void> }> }> = [];
  const published: string[] = [];
  let slotRenderer: (() => unknown) | undefined;
  const api = {
    kv: { get: () => false, set: () => undefined },
    ui: { toast: () => undefined },
    client: {
      tui: {
        publish: async ({ body }: { body: { properties: { command: string } } }) => {
          published.push(body.properties.command);
          return {};
        },
      },
    },
    keymap: { registerLayer: (layer: { commands?: Array<{ run?: () => Promise<void> }> }) => layers.push(layer) },
    slots: {
      register: (registration: { slots: { session_prompt_right: () => unknown } }) => {
        slotRenderer = registration.slots.session_prompt_right;
      },
    },
  };
  const plugin = tuiModule.default;
  await Reflect.apply(plugin.tui, undefined, [api, "/tmp", { lang: 42 }]);
  expect(layers.length).toBe(2);
  const firstLayer = layers[0];
  if (firstLayer === undefined || firstLayer.commands === undefined) throw new Error("Missing command layer");
  const command = firstLayer.commands[0];
  if (command === undefined || command.run === undefined) throw new Error("Missing toggle command");
  expect(typeof command.run).toBe("function");
  const publishPromise = command.run();
  await publishPromise;
  expect(published).toEqual([
    "opencode-auto-translate.toggle:off",
    "opencode-auto-translate.toggle:on",
  ]);
  if (slotRenderer === undefined) throw new Error("Missing status slot");
  expect(typeof slotRenderer).toBe("function");
});

test("TUI bundle keeps Solid as a host dependency", async () => {
  const packageText = await Bun.file("package.json").text()
  expect(packageText).toContain("--external 'solid-js'")
  expect(packageText).toContain('"solid-js": "1.9.12"')
})
