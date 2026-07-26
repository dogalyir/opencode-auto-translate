/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import { parseToggleCommand, TRANSLATION_EVENT } from "./translation"

const ID = "opencode-auto-translate"
const KEY = `${ID}.enabled`

const tui: TuiPlugin = async (api) => {
  const storedValue = api.kv.get<unknown>(KEY, false)
  const initialState = typeof storedValue === "boolean" ? storedValue : false
  const [isEnabled, setEnabled] = createSignal(initialState)
  const publish = async (enabled: boolean) => {
    api.kv.set(KEY, enabled)
    setEnabled(enabled)
    api.ui.toast({
      title: "Auto-translation",
      message: enabled ? "Enabled" : "Disabled",
      variant: enabled ? "success" : "info",
    })
    const response = await api.client.tui.publish({
      body: { type: "tui.command.execute", properties: { command: `${TRANSLATION_EVENT}:${enabled ? "on" : "off"}` } },
    })
    if (response.error) {
      setEnabled(!enabled)
      api.kv.set(KEY, !enabled)
      api.ui.toast({ title: "Auto-translation", message: "Could not update server state", variant: "error" })
    }
  }

  api.keymap.registerLayer({
    mode: "base",
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
    bindings: [{ key: "ctrl+shift+t", cmd: `${ID}.toggle`, desc: "Toggle auto-translation" }],
  })

  api.slots.register({
    slots: {
      session_prompt_right: () => <text>{isEnabled() ? " [translate: on]" : " [translate: off]"}</text>,
    },
  })

  const initialCommand = `${TRANSLATION_EVENT}:${isEnabled() ? "on" : "off"}`
  if (parseToggleCommand(initialCommand) !== undefined) await publish(isEnabled())
}

const plugin: TuiPluginModule & { id: string } = { id: ID, tui }
export default plugin
