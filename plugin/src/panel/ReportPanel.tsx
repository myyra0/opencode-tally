/* @jsxImportSource @opentui/solid */
// Full session panel. The view renders every section from a ReportView and QuotaView; the
// container owns both RPC resources, refresh triggers, keymap, and scrollbox.

import type { Plugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createMemo, createResource, For, on } from "solid-js"
import type { JSX } from "@opentui/solid"

import type { QuotaView } from "../lib/quota/types.js"
import { TallyRpc, toError, type ReportRow, type ReportUsage, type ReportView } from "../lib/rpc.js"
import { barCells, formatPercent, formatTokens, formatUsd } from "../ui/format.js"
import { Line, Row, Section, type Theme } from "../ui/primitives.js"
import { QuotaSection } from "../ui/quota.js"

export const PANEL_NAME = "tally.report"

const LABEL_WIDTH = 24
const VALUE_WIDTH = 10
const PERCENT_WIDTH = 7
const MIN_BAR_WIDTH = 6
const MAX_BAR_WIDTH = 40
const SCROLL_STEP = 3
const SCROLL_PAGE = 20

// Appended to a cost that is not, or not entirely, what OpenCode recorded.
const COST_BASIS_NOTE = {
  recorded: "",
  estimated: " (estimate)",
  mixed: " (partly estimated)",
} as const

function usageRows(usage: ReportUsage): ReportRow[] {
  return [
    { label: "Input (fresh)", tokens: usage.input },
    { label: "Cache read", tokens: usage.cacheRead },
    { label: "Cache write", tokens: usage.cacheWrite },
    { label: "Output", tokens: usage.output },
    { label: "Reasoning", tokens: usage.reasoning },
  ].filter((row) => row.tokens > 0)
}

function usageTotal(usage: ReportUsage): number {
  return usage.input + usage.cacheRead + usage.cacheWrite + usage.output + usage.reasoning
}

function rawPercent(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0
}

function BarRows(props: {
  rows: readonly ReportRow[]
  total: number
  theme: Theme
  barWidth: number
  suffix?: (row: ReportRow) => string
}): JSX.Element {
  return (
    <For each={props.rows.filter((row) => row.tokens > 0)}>
      {(row) => (
        <Row
          theme={props.theme}
          label={row.label}
          labelWidth={LABEL_WIDTH}
          valueWidth={VALUE_WIDTH}
          cells={barCells(rawPercent(row.tokens, props.total), props.barWidth)}
          barWidth={props.barWidth}
          percent={props.suffix ? props.suffix(row) : formatPercent(row.tokens, props.total)}
          value={formatTokens(row.tokens, false)}
          detail={row.detail}
        />
      )}
    </For>
  )
}

function ReportData(props: {
  report: ReportView
  quota?: QuotaView
  theme: Theme
  barWidth: number
  quotaError?: Error
}): JSX.Element {
  const data = () => props.report
  const toolTotal = () => data().tools.reduce((sum, tool) => sum + tool.tokens, 0)
  const calls = () => new Map(data().tools.map((tool) => [tool.name, tool.calls]))
  const limit = () => data().contextLimit

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="column" flexShrink={0}>
        <text fg={props.theme.text.muted} wrapMode="none" truncate>
          {`${data().model} · ${data().steps} steps · ${data().tokenizer} tokenizer`}
        </text>
        <text fg={props.theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none">
          {`${formatUsd(data().total.cost)}${COST_BASIS_NOTE[data().total.costBasis]} · ${formatTokens(data().total.tokens, false)} tokens`}
        </text>
      </box>

      {data().warnings.length > 0 ? (
        <box flexDirection="column" flexShrink={0}>
          <For each={data().warnings}>
            {(warning) => (
              <text fg={props.theme.text.feedback.warning.base}>{`! ${warning}`}</text>
            )}
          </For>
        </box>
      ) : null}

      {props.quotaError ? (
        <text fg={props.theme.text.feedback.error.base} wrapMode="none">
          {`Quota unavailable: ${props.quotaError?.message ?? ""}`}
        </text>
      ) : null}
      {props.quota ? (
        <QuotaSection
          view={props.quota}
          theme={props.theme}
          barWidth={props.barWidth}
          compact={false}
          showResetTime
        />
      ) : null}

      <Section
        theme={props.theme}
        title="Context"
        note={data().content.scale === undefined ? "local estimate" : undefined}
      >
        {limit() !== undefined ? (
          <Row
            theme={props.theme}
            label="Tokens"
            labelWidth={LABEL_WIDTH}
            valueWidth={20}
            cells={barCells(rawPercent(data().content.total, limit()!), props.barWidth)}
            barWidth={props.barWidth}
            percent={formatPercent(data().content.total, limit()!)}
            value={`${formatTokens(data().content.total, false)} / ${formatTokens(limit()!, false)}`}
            strong
          />
        ) : (
          <Line
            theme={props.theme}
            label="Tokens"
            value={`${formatTokens(data().content.total, false)} tokens`}
            labelWidth={LABEL_WIDTH}
            strong
          />
        )}
      </Section>

      <Section theme={props.theme} title="Recorded usage" note={`${data().steps} completed steps`}>
        <BarRows rows={usageRows(data().recorded)} total={usageTotal(data().recorded)} theme={props.theme} barWidth={props.barWidth} />
        <Line
          theme={props.theme}
          label="Total"
          labelWidth={LABEL_WIDTH}
          value={`${formatTokens(usageTotal(data().recorded), false)} tokens`}
          strong
        />
        <Line
          theme={props.theme}
          label={data().costBasis === "estimated" ? "Cost (API-rate estimate)" : "Cost (recorded)"}
          labelWidth={LABEL_WIDTH}
          value={formatUsd(data().cost)}
          strong
        />
        {data().cache ? (
          <Line
            theme={props.theme}
            label="Cache hit rate"
            labelWidth={LABEL_WIDTH}
            value={`${data().cache!.hitRate.toFixed(1)}% · saved ${formatUsd(data().cache!.savings)} (${data().cache!.savingsPercent.toFixed(1)}%)`}
          />
        ) : null}
      </Section>

      <Section
        theme={props.theme}
        title="Context window"
        note={
          data().content.scale === undefined
            ? "local estimate"
            : `recorded total, local split scaled ×${data().content.scale!.toFixed(2)}`
        }
      >
        <BarRows rows={data().content.rows} total={data().content.total} theme={props.theme} barWidth={props.barWidth} />
        <Line
          theme={props.theme}
          label="Total"
          labelWidth={LABEL_WIDTH}
          value={`${formatTokens(data().content.total, false)} tokens`}
          strong
        />
      </Section>

      {data().steps > 0 ? (
        <Section theme={props.theme} title="Last request" note="recorded by OpenCode">
          <BarRows rows={usageRows(data().lastStep)} total={usageTotal(data().lastStep)} theme={props.theme} barWidth={props.barWidth} />
          <Line
            theme={props.theme}
            label="Total"
            labelWidth={LABEL_WIDTH}
            value={`${formatTokens(usageTotal(data().lastStep), false)} tokens`}
            strong
          />
        </Section>
      ) : null}

      {data().context ? (
        <Section
          theme={props.theme}
          title="Always-sent context"
          note={data().context!.measured ? "measured from the latest request" : "estimated from the first cache write"}
        >
          <BarRows rows={data().context!.components} total={data().context!.total} theme={props.theme} barWidth={props.barWidth} />
          <Line
            theme={props.theme}
            label="Total"
            labelWidth={LABEL_WIDTH}
            value={`${data().context!.measured ? "~" : ""}${formatTokens(data().context!.total, false)} tokens`}
            strong
          />
        </Section>
      ) : null}

      {data().tools.length > 0 ? (
        <Section theme={props.theme} title="Tool output">
          <BarRows
            rows={data().tools.filter((tool) => tool.tokens > 0).map((tool) => ({ label: tool.name, tokens: tool.tokens }))}
            total={toolTotal()}
            theme={props.theme}
            barWidth={props.barWidth}
            suffix={(row) => `${calls().get(row.label) ?? 0}x`.padStart(PERCENT_WIDTH - 1)}
          />
        </Section>
      ) : null}

      {data().topContributors.length > 0 ? (
        <Section theme={props.theme} title="Top contributors">
          <BarRows rows={data().topContributors} total={data().content.total} theme={props.theme} barWidth={props.barWidth} />
        </Section>
      ) : null}

      {data().subagents ? (
        <Section
          theme={props.theme}
          title="Subagents"
          note={`${data().subagents!.sessions.length} child ${data().subagents!.sessions.length === 1 ? "session" : "sessions"}`}
        >
          <For each={data().subagents!.sessions}>
            {(session) => (
              <Line
                theme={props.theme}
                label={session.agent}
                labelWidth={LABEL_WIDTH}
                value={`${formatUsd(session.cost)}${COST_BASIS_NOTE[session.costBasis]} · ${formatTokens(session.tokens, false)} tokens · ${session.steps} steps`}
              />
            )}
          </For>
          <Line
            theme={props.theme}
            label="Session + subagents"
            labelWidth={LABEL_WIDTH}
            value={`${formatUsd(data().total.cost)}${COST_BASIS_NOTE[data().total.costBasis]} · ${formatTokens(data().total.tokens, false)} tokens · ${data().total.steps} steps`}
            strong
          />
        </Section>
      ) : null}
    </box>
  )
}

export interface ReportPanelViewProps {
  report: ReportView | undefined
  quota?: QuotaView
  theme: Theme
  width: number
  loading?: boolean
  error?: Error
  quotaError?: Error
  scrollRef?: (element: ScrollBoxRenderable) => void
}

/** Pure panel view: no RPC, no context; renderable directly in tests. */
export function ReportPanelView(props: ReportPanelViewProps): JSX.Element {
  // Two columns of padding on each side, one space between each column.
  const barWidth = createMemo(() =>
    Math.max(
      MIN_BAR_WIDTH,
      Math.min(MAX_BAR_WIDTH, props.width - 4 - LABEL_WIDTH - VALUE_WIDTH - PERCENT_WIDTH - 3)
    )
  )

  return (
    <box width="100%" height="100%" flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
      <box flexDirection="row" justifyContent="space-between" height={2} flexShrink={0}>
        <text fg={props.theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none">
          Tally
        </text>
        <text fg={props.theme.text.faint} wrapMode="none">
          r refresh · f full screen · esc close
        </text>
      </box>
      <scrollbox
        ref={(element: ScrollBoxRenderable) => props.scrollRef?.(element)}
        flexGrow={1}
        minHeight={0}
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        {props.error ? (
          <text fg={props.theme.text.feedback.error.base}>
            {`Could not load the report: ${props.error?.message ?? ""}`}
          </text>
        ) : props.report ? (
          <ReportData
            report={props.report}
            quota={props.quota}
            theme={props.theme}
            barWidth={barWidth()}
            quotaError={props.quotaError}
          />
        ) : props.loading ? (
          <text fg={props.theme.text.muted}>Analyzing session…</text>
        ) : null}
      </scrollbox>
    </box>
  )
}

/** Container: owns both RPC resources, the idle/manual refetch triggers, and the keymap. */
export function ReportPanel(props: { context: Plugin.Context; panel: PanelInput }): JSX.Element {
  const theme = props.context.theme
  let scroll: ScrollBoxRenderable | undefined

  const [report, { refetch: refetchReport }] = createResource(
    () => props.panel.sessionID,
    async (sessionID): Promise<ReportView> => {
      const directory = props.context.data.session.get(sessionID)?.location.directory
      try {
        const output = await props.context.client
          .rpc(TallyRpc)
          .report({ sessionID }, directory ? { location: { directory } } : undefined)
        return output as ReportView
      } catch (failure) {
        throw toError(failure)
      }
    }
  )

  const [quota, { refetch: refetchQuota }] = createResource(async (): Promise<QuotaView> => {
    try {
      const output = await props.context.client.rpc(TallyRpc).quota({})
      return output as QuotaView
    } catch (failure) {
      throw toError(failure)
    }
  })

  const refresh = () => {
    void refetchReport()
    void refetchQuota()
  }

  // Keep the open panel current: reload both resources when the session finishes a run.
  const status = createMemo(() => props.context.data.session.status(props.panel.sessionID))
  createEffect(
    on(
      status,
      (current, previous) => {
        if (previous === "running" && current === "idle") refresh()
      },
      { defer: true }
    )
  )

  props.context.keymap.layer(() => ({
    commands: [
      { bind: "escape", title: "close", run: () => props.panel.close() },
      { bind: "r", title: "refresh", run: refresh },
      { bind: "f", title: "full screen", run: () => props.panel.toggleFullscreen() },
      { bind: "down", run: () => scroll?.scrollBy(SCROLL_STEP) },
      { bind: "up", run: () => scroll?.scrollBy(-SCROLL_STEP) },
      { bind: "pagedown", run: () => scroll?.scrollBy(SCROLL_PAGE) },
      { bind: "pageup", run: () => scroll?.scrollBy(-SCROLL_PAGE) },
    ],
  }))

  return (
    <ReportPanelView
      report={report()}
      quota={quota()}
      theme={theme}
      width={props.panel.width}
      loading={report.loading}
      error={report.error}
      quotaError={quota.error}
      scrollRef={(element) => (scroll = element)}
    />
  )
}
