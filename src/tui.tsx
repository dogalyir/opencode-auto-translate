/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { createSignal } from "solid-js";
import { pluginOptionsSchema, TRANSLATION_EVENT } from "./translation";

const ID = "opencode-auto-translate";
const KEY = `${ID}.enabled`;

const tui: TuiPlugin = async (api, options) => {
  const parsedOptions = pluginOptionsSchema.safeParse(options);
  const language = parsedOptions.success ? parsedOptions.data.lang : "English";
  const storedValue = api.kv.get<unknown>(KEY, false);
  const initialState = typeof storedValue === "boolean" ? storedValue : false;
  const [isEnabled, setEnabled] = createSignal(initialState);
  const publish = async (enabled: boolean) => {
    api.kv.set(KEY, enabled);
    setEnabled(enabled);
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
      if (!response.error) return;
    } catch {
      // Restore the local state when the server cannot receive the toggle.
    }
    setEnabled(!enabled);
    api.kv.set(KEY, !enabled);
    api.ui.toast({
      title: "Auto-translation",
      message: "Could not update server state",
      variant: "error",
    });
  };

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
  })

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
        <text>
          {isEnabled()
            ? ` [translate: on -> ${language}]`
            : " [translate: off]"}
        </text>
      ),
    },
  });
};

const plugin: TuiPluginModule & { id: string } = { id: ID, tui };
export default plugin;
