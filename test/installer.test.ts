import { expect, test } from "bun:test";
import {
  createTranslationConfig,
  getConfigDirectory,
  registerPlugin,
} from "../src/installer";

test("resolves OpenCode config directory with environment precedence", () => {
  expect(
    getConfigDirectory({
      OPENCODE_CONFIG_DIR: "/custom",
      XDG_CONFIG_HOME: "/xdg",
    }),
  ).toBe("/custom");
  expect(getConfigDirectory({ XDG_CONFIG_HOME: "/xdg" })).toBe("/xdg/opencode");
});

test("registers server and TUI plugins idempotently", () => {
  const registered = registerPlugin('{"plugin":["other"]}', "opencode.json");
  expect(JSON.parse(registered)).toEqual({
    plugin: ["other", "opencode-auto-translate@latest"],
  });
  expect(registerPlugin(registered, "opencode.json")).toBe(registered);
  expect(
    registerPlugin(
      '{"plugin":[["opencode-auto-translate@latest",{}]]}',
      "tui.json",
    ),
  ).toContain("opencode-auto-translate@latest");
});

test("refuses unsupported configuration roots", () => {
  expect(() => registerPlugin("// comment\n{}", "opencode.json")).toThrow(
    "Cannot safely update",
  );
  expect(() => registerPlugin('{"plugin":"other"}', "tui.json")).toThrow(
    "plugin must be an array",
  );
});

test("creates the guided translation configuration", () => {
  expect(
    JSON.parse(
      createTranslationConfig({
        enabled: true,
        lang: "Spanish",
        model: "openai/model",
        output: "show translation",
      }),
    ),
  ).toEqual({
    $schema:
      "https://unpkg.com/opencode-auto-translate@latest/dist/translate.schema.json",
    enabled: true,
    lang: "Spanish",
    model: "openai/model",
    output: "show translation",
  });
});
