/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { createSignal } from "solid-js";
import { loadPluginOptions } from "./config";
import { TRANSLATION_EVENT, TRANSLATION_ID } from "./translation";

const ID = TRANSLATION_ID;
const KEY = `${ID}.enabled`;

const tui: TuiPlugin = async (api, _directory, options) => {
  const pluginOptions = await loadPluginOptions(options);
  const language = pluginOptions.lang;
  const storedValue = api.kv.get<unknown>(KEY, undefined);
  const initialState =
    typeof storedValue === "boolean" ? storedValue : pluginOptions.enabled === true;
  const [isEnabled, setEnabled] = createSignal(initialState);
  const publish = async (enabled: boolean, showToast = true, rollbackOnFailure = true) => {
    api.kv.set(KEY, enabled);
    setEnabled(enabled);
    if (showToast)
      api.ui.toast({
        title: "Auto-translation",
        message: enabled ? "Enabled" : "Disabled",
        variant: enabled ? "success" : "info",
      });
    try {
      const response = await api.client.tui.publish({
        body: {
          type: "tui.command.execute",
          properties: {
            command: `${TRANSLATION_EVENT}:${enabled ? "on" : "off"}`,
          },
        },
      });
      if (response.error === undefined) return;
      console.warn("Auto-translation toggle rejected", String(response.error));
    } catch (error) {
      console.warn("Auto-translation toggle publish failed", String(error));
      // Restore the local state when the server cannot receive the toggle.
    }
    if (!rollbackOnFailure) return;
    setEnabled(!enabled);
    api.kv.set(KEY, !enabled);
    api.ui.toast({
      title: "Auto-translation",
      message: "Could not update server state",
      variant: "error",
    });
  };

  await publish(initialState, false, false);

  api.keymap.registerLayer({
    commands: [
      {
        name: `${ID}.toggle`,
        title: "Toggle auto-translation",
        category: "Plugin",
        namespace: "palette",
        slashName: "translate",
        desc: "Toggle translation of user prompts to English",
        run: () => publish(!isEnabled()),
      },
    ],
  });

  api.keymap.registerLayer({
    mode: "base",
    bindings: [
      {
        key: "ctrl+shift+t",
        cmd: `${ID}.toggle`,
        desc: "Toggle auto-translation",
      },
    ],
  });

  api.slots.register({
    slots: {
      session_prompt_right: () => (
        <text>{isEnabled() ? ` [translate: on -> ${language}]` : " [translate: off]"}</text>
      ),
    },
  });
};

const plugin: TuiPluginModule & { id: string } = { id: ID, tui };
export default plugin;
