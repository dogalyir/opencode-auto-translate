import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { pluginOptionsSchema, type PluginOptions } from "./translation";

const CONFIG_FILE = "translate.json";

function configDirectory(): string {
  const configuredDirectory = process.env["OPENCODE_CONFIG_DIR"];
  if (
    configuredDirectory !== undefined &&
    configuredDirectory.trim().length > 0
  )
    return configuredDirectory;
  const xdgDirectory = process.env["XDG_CONFIG_HOME"];
  if (xdgDirectory !== undefined && xdgDirectory.trim().length > 0)
    return join(xdgDirectory, "opencode");
  return join(homedir(), ".config", "opencode");
}

function translationConfigPath(): string {
  return join(configDirectory(), CONFIG_FILE);
}

export async function loadPluginOptions(
  options: unknown,
): Promise<PluginOptions> {
  let fileOptions: unknown = {};
  try {
    const file = Bun.file(translationConfigPath());
    if (await file.exists()) fileOptions = await file.json();
  } catch (error) {
    console.warn(
      "Could not read translate.json; using plugin options",
      String(error),
    );
  }

  const parsedFileOptions = pluginOptionsSchema.safeParse(fileOptions);
  if (!parsedFileOptions.success) {
    console.warn(
      "Invalid translate.json; using plugin options",
      parsedFileOptions.error.issues,
    );
    fileOptions = {};
  } else {
    fileOptions = parsedFileOptions.data;
  }

  const parsedFileRecord = z
    .record(z.string(), z.unknown())
    .safeParse(fileOptions);
  const parsedInlineRecord = z
    .record(z.string(), z.unknown())
    .safeParse(options ?? {});
  const mergedOptions = {
    ...(parsedFileRecord.success ? parsedFileRecord.data : {}),
    ...(parsedInlineRecord.success ? parsedInlineRecord.data : {}),
  };
  const parsedOptions = pluginOptionsSchema.safeParse(mergedOptions);
  if (parsedOptions.success) return parsedOptions.data;
  console.warn(
    "Invalid auto-translation options; using defaults",
    parsedOptions.error.issues,
  );
  return pluginOptionsSchema.parse({});
}
