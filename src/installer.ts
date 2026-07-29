import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { PluginOptions } from "./translation";

const PACKAGE_NAME = "opencode-auto-translate@latest";
const SCHEMA_URL = "https://unpkg.com/opencode-auto-translate@latest/dist/translate.schema.json";
const pluginEntrySchema = z.union([
  z.string(),
  z.tuple([z.string().min(1), z.record(z.string(), z.unknown())]),
]);

export type InstallerOptions = Required<
  Pick<PluginOptions, "enabled" | "lang" | "input" | "output">
> &
  Pick<PluginOptions, "model" | "variant">;

export function getConfigDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment["OPENCODE_CONFIG_DIR"];
  if (configured !== undefined && configured.trim().length > 0) return configured;
  const xdg = environment["XDG_CONFIG_HOME"];
  if (xdg !== undefined && xdg.trim().length > 0) return join(xdg, "opencode");
  return join(homedir(), ".config", "opencode");
}

export function registerPlugin(text: string, filePath: string): string {
  let config: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error("configuration root must be an object");
    const record = z.record(z.string(), z.unknown()).safeParse(parsed);
    if (!record.success) throw new Error("configuration root must be an object");
    config = record.data;
  } catch (error) {
    throw new Error(`Cannot safely update ${filePath}: ${String(error)}`);
  }

  const plugins = config["plugin"];
  if (plugins === undefined) {
    config["plugin"] = [PACKAGE_NAME];
  } else if (Array.isArray(plugins)) {
    const parsedPlugins = z.array(pluginEntrySchema).safeParse(plugins);
    if (!parsedPlugins.success)
      throw new Error(`Cannot safely update ${filePath}: plugin entries are invalid`);
    if (
      !plugins.some(
        (plugin) =>
          plugin === PACKAGE_NAME || (Array.isArray(plugin) && plugin[0] === PACKAGE_NAME),
      )
    )
      config["plugin"] = [...parsedPlugins.data, PACKAGE_NAME];
  } else {
    throw new Error(`Cannot safely update ${filePath}: plugin must be an array`);
  }
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function createTranslationConfig(options: InstallerOptions): string {
  const config: Record<string, unknown> = {
    $schema: SCHEMA_URL,
    enabled: options.enabled,
    lang: options.lang,
    input: options.input,
    output: options.output,
    excluded_agents: [],
  };
  if (options.model !== undefined) config["model"] = options.model;
  if (options.variant !== undefined) config["variant"] = options.variant;
  return `${JSON.stringify(config, null, 2)}\n`;
}
