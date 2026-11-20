// TUI part: /tally opens the session panel, which renders the report over RPC without a model request.
// Nothing here is added to the session being measured.

import { Plugin } from "@opencode/plugin/tui"
import { Show } from "solid-js"

import { PANEL_NAME, ReportPanel } from "./panel/ReportPanel.js"
import { Sidebar } from "./sidebar/Sidebar.js"

export default Plugin.define({
  id: "tally.tui",
  setup(context) {
    context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === PANEL_NAME}>
          <ReportPanel context={context} panel={panel} />
        </Show>
      ),
    })

    context.ui.slot({
      append: "sidebar.content",
      render: (sidebar) => <Sidebar context={context} sessionID={sidebar.sessionID} />,
    })

    context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "tally.open",
              title: "Token usage report",
              description: "Show token usage for this session",
              group: "Session",
              slash: { name: "tally" },
              palette: true,
              run: () => {
                context.ui.dialog.clear()
                const route = context.ui.router.current()
                const current = context.ui.panel.current()
                if (route.type === "session" && current?.name === PANEL_NAME && current.sessionID === route.sessionID) {
                  context.ui.panel.close()
                  return
                }
                if (!context.ui.panel.open(PANEL_NAME)) {
                  context.ui.toast.show({ message: "Open a session to see its token usage.", variant: "info" })
                }
              },
            },
          ],
        }))
        return null
      },
    })
  },
})
