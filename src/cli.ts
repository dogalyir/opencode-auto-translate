#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  createTranslationConfig,
  getConfigDirectory,
  registerPlugin,
  type InstallerOptions,
} from "./installer";

async function askRequired(prompt: string, fallback: string): Promise<string> {
  const answer = (await promptInput(prompt, fallback)).trim();
  return answer.length > 0 ? answer : fallback;
}

async function promptInput(prompt: string, fallback: string): Promise<string> {
  const answer = await promptInputInterface.question(`${prompt} [${fallback}] `);
  return answer.trim().length > 0 ? answer : fallback;
}

const promptInputInterface = createInterface({ input, output });

async function main(): Promise<void> {
  try {
    console.log("OpenCode Auto Translate setup\n");
    const lang = await askRequired("Target language", "English");
    const model = await promptInput("Translation model (leave blank to use small_model)", "");
    const variant = await promptInput("Model variant (leave blank for none)", "");
    const enabled =
      (await promptInput("Enable translation at startup? (y/n)", "y")).toLowerCase() !== "n";
    const outputMode = await promptInput("Output mode (original/translation/both)", "translation");
    let output: InstallerOptions["output"] = "show translation";
    if (outputMode === "original") output = "show original";
    if (outputMode === "both") output = "show original + translation";
    const options: InstallerOptions = {
      enabled,
      lang,
      ...(model.length > 0 ? { model } : {}),
      ...(variant.length > 0 ? { variant } : {}),
      output,
    };

    const configDirectory = getConfigDirectory();
    await mkdir(configDirectory, { recursive: true });
    for (const fileName of ["opencode.json", "tui.json"]) {
      const filePath = join(configDirectory, fileName);
      let current = "{}\n";
      try {
        current = await readFile(filePath, "utf8");
      } catch (error) {
        if (
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          error.code !== "ENOENT"
        )
          throw error;
      }
      await writeFile(filePath, registerPlugin(current, filePath));
    }
    await writeFile(join(configDirectory, "translate.json"), createTranslationConfig(options));
    console.log(
      `\nConfigured OpenCode in ${configDirectory}. Restart OpenCode to load the plugin.`,
    );
  } finally {
    promptInputInterface.close();
  }
}

if (import.meta.main)
  await main().catch((error: unknown) => {
    console.error(String(error));
    process.exitCode = 1;
  });
