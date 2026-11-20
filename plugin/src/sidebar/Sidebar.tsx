/* @jsxImportSource @opentui/solid */
// Always-on sidebar. `SidebarView` renders the same report/quota model as the panel; `Sidebar`
// owns the config load, both RPCs, and the refresh timer.

import type { Plugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show, type Accessor } from "solid-js"
import type { JSX } from "@opentui/solid"

import { formatTimestamp } from "../lib/quota/format.js"
import type { QuotaView, SidebarConfig, SidebarSection } from "../lib/quota/types.js"
import { TallyRpc, toError, type ReportRow, type ReportView } from "../lib/rpc.js"
import { barCells, formatPercent, formatTokens, formatUsd } from "../ui/format.js"
import { Line, Row, Section, type Theme } from "../ui/primitives.js"
import { QuotaSection } from "../ui/quota.js"
import { DEFAULT_SIDEBAR_CONFIG, loadSidebarConfig } from "./config.js"
import { resolveSections } from "./sections.js"

const LABEL_WIDTH = 9
const NARROW_LABEL_WIDTH = 7
const VALUE_WIDTH = 6
const QUOTA_BAR_WIDTH = 12
const LOCAL_BAR_WIDTH = 8
// Fixed target layout; the host clips anything narrower. The slot does not supply a width.
const TARGET_WIDTH = 34

function usageTotal(usage: ReportView["recorded"]): number {
  return usage.input + usage.cacheRead + usage.cacheWrite + usage.output + usage.reasoning
}

function recordedRows(usage: ReportView["recorded"]): ReportRow[] {
  return [
    { label: "input", tokens: usage.input },
    { label: "cache rd", tokens: usage.cacheRead },
    ...(usage.cacheWrite > 0 ? [{ label: "cache wr", tokens: usage.cacheWrite }] : []),
    { label: "output", tokens: usage.output },
    ...(usage.reasoning > 0 ? [{ label: "reasoning", tokens: usage.reasoning }] : []),
  ]
}

// The sidebar's label column is narrower than the panel's. Shorten the few view labels that
// would otherwise be truncated mid-word.
const SIDEBAR_LABELS: Record<string, string> = {
  "System prompt": "system",
  "Tool output": "tools",
}

function sidebarRows(rows: ReportRow[]): ReportRow[] {
  return rows.map((row) => ({ ...row, label: SIDEBAR_LABELS[row.label] ?? row.label }))
}

/**
 * Reactive derivations for the compact sections. Every returned member is an accessor so it can
 * be called inline in JSX and follow report changes across refetches.
 */
export function recordedDerived(report: Accessor<ReportView | undefined>) {
  const usage = () => report()?.recorded
  return {
    total: () => {
      const value = usage()
      return value ? usageTotal(value) : 0
    },
    rows: () => {
      const value = usage()
      return value ? recordedRows(value) : []
    },
  }
}

export function contextDerived(report: Accessor<ReportView | undefined>) {
  return {
    limit: () => report()?.contextLimit,
    total: () => report()?.content.total ?? 0,
  }
}

/** Value text for the Context row, or total-only text when the model limit is unknown. */
export function contextValueText(total: number, limit: number | undefined): string {
  const tokens = formatTokens(total, true)
  return limit === undefined ? `${tokens} tokens` : `${tokens} / ${formatTokens(limit, true)}`
}

function LocalRows(props: {
  rows: readonly ReportRow[]
  total: number
  theme: Theme
  labelWidth: number
  flexLabel?: boolean
  showBars: boolean
  showPercentages: boolean
}): JSX.Element {
  return (
    <For each={props.rows.filter((row) => row.tokens > 0)}>
      {(row) => (
        <Row
          theme={props.theme}
          label={row.label}
          labelWidth={props.labelWidth}
          flexLabel={props.flexLabel}
          valueWidth={VALUE_WIDTH}
          cells={props.showBars ? barCells(props.total > 0 ? (row.tokens / props.total) * 100 : 0, LOCAL_BAR_WIDTH) : undefined}
          barWidth={props.showBars ? LOCAL_BAR_WIDTH : undefined}
          brackets={props.showBars}
          percent={props.showPercentages ? formatPercent(row.tokens, props.total) : undefined}
          value={formatTokens(row.tokens, true)}
        />
      )}
    </For>
  )
}

export interface SidebarViewProps {
  report?: ReportView
  quota?: QuotaView
  theme: Theme
  config: SidebarConfig
  width: number
  loading?: boolean
  error?: Error
  /** Validation/parse messages from the sidebar config, shown through the config-error surface. */
  configDiagnostics?: string[]
  quotaError?: Error
  /** Time of the sidebar's last refresh; the Updated line falls back to the report time. */
  refreshedAt?: number
}

/** Pure sidebar view: no RPC, no plugin context; renderable directly in tests. */
export function SidebarView(props: SidebarViewProps): JSX.Element {
  const labelWidth = () => (props.width < 32 ? NARROW_LABEL_WIDTH : LABEL_WIDTH)
  const report = () => props.report
  const recorded = recordedDerived(report)
  const context = contextDerived(report)
  const sections = () => resolveSections(props.config)

  const renderSection = (section: SidebarSection): JSX.Element => {
    switch (section) {
      case "quota":
        return (
          <box flexDirection="column" flexShrink={0}>
            {props.quotaError ? (
              <text fg={props.theme.text.feedback.error.base} wrapMode="none">
                {`Quota unavailable: ${props.quotaError?.message ?? ""}`}
              </text>
            ) : null}
            {props.quota ? (
              <QuotaSection
                view={props.quota}
                theme={props.theme}
                barWidth={QUOTA_BAR_WIDTH}
                compact
                showResetTime={false}
                labelWidth={labelWidth()}
                flexLabel
                showBar={props.config.showBars}
                showPercent={props.config.showPercentages}
                providerDisplays={props.quota.providerDisplays}
                windowScope="sidebar"
              />
            ) : null}
          </box>
        )

      case "context":
        // The outer Show needs a one-argument child to stay reactive; the inner keyed Show picks
        // the row/total-only branch from the current limit and hands the Row a definite number.
        return (
          <Section theme={props.theme} title="Context">
            <Show when={report()}>
              {(_current) => (
                <Show
                  when={context.limit()}
                  keyed
                  fallback={
                    <Line
                      theme={props.theme}
                      label="Tokens"
                      labelWidth={labelWidth()}
                      flexLabel
                      value={contextValueText(context.total(), undefined)}
                      strong
                    />
                  }
                >
                  {(limit) => (
                    <Row
                      theme={props.theme}
                      label="Tokens"
                      labelWidth={labelWidth()}
                      flexLabel
                      valueWidth={VALUE_WIDTH}
                      cells={
                        props.config.showBars
                          ? barCells((context.total() / limit) * 100, LOCAL_BAR_WIDTH)
                          : undefined
                      }
                      barWidth={props.config.showBars ? LOCAL_BAR_WIDTH : undefined}
                      brackets={props.config.showBars}
                      percent={props.config.showPercentages ? formatPercent(context.total(), limit) : undefined}
                      value={contextValueText(context.total(), limit)}
                      strong
                    />
                  )}
                </Show>
              )}
            </Show>
          </Section>
        )

      case "recorded":
        return (
          <Section theme={props.theme} title="Recorded usage">
            <Show when={report()}>
              {(current) => (
                <>
                  <LocalRows
                    rows={recorded.rows()}
                    total={recorded.total()}
                    theme={props.theme}
                    labelWidth={labelWidth()}
                    flexLabel
                    showBars={props.config.showBars}
                    showPercentages={props.config.showPercentages}
                  />
                  <Line
                    theme={props.theme}
                    label="total"
                    labelWidth={labelWidth()}
                    flexLabel
                    value={`${formatTokens(recorded.total(), true)} tokens`}
                    strong
                  />
                  <Line
                    theme={props.theme}
                    label={current().costBasis === "estimated" ? "cost est" : "cost"}
                    labelWidth={labelWidth()}
                    flexLabel
                    value={formatUsd(current().cost)}
                    strong
                  />
                  <Show when={current().cache}>
                    {(cache) => (
                      <Line
                        theme={props.theme}
                        label="cache hit"
                        labelWidth={labelWidth()}
                        flexLabel
                        value={`${cache().hitRate.toFixed(1)}% · saved ${formatUsd(cache().savings)}`}
                      />
                    )}
                  </Show>
                </>
              )}
            </Show>
          </Section>
        )

      case "contextWindow":
        return (
          <Section theme={props.theme} title="Context window">
            <Show when={report()}>
              {(current) => (
                <>
                  <LocalRows
                    rows={sidebarRows(current().content.rows)}
                    total={current().content.total}
                    theme={props.theme}
                    labelWidth={labelWidth()}
                    flexLabel
                    showBars={props.config.showBars}
                    showPercentages={props.config.showPercentages}
                  />
                  <Line
                    theme={props.theme}
                    label="total"
                    labelWidth={labelWidth()}
                    flexLabel
                    value={`${formatTokens(current().content.total, true)} tokens`}
                    strong
                  />
                </>
              )}
            </Show>
          </Section>
        )
    }
  }

  return (
    <box width="100%" flexDirection="column" flexShrink={0} gap={1}>
      <text fg={props.theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none">
        Tally
      </text>
      <For each={props.configDiagnostics ?? []}>
        {(diagnostic) => (
          <text fg={props.theme.text.feedback.warning.base} wrapMode="none">
            {diagnostic}
          </text>
        )}
      </For>
      {props.error ? (
        <text fg={props.theme.text.feedback.error.base} wrapMode="none">
          {`Report unavailable: ${props.error?.message ?? ""}`}
        </text>
      ) : null}
      {!props.report && props.loading ? (
        <text fg={props.theme.text.muted} wrapMode="none">
          Analyzing session…
        </text>
      ) : null}
      <For each={sections()}>{(section) => renderSection(section)}</For>
      <Show when={report()}>
        {(current) => (
          <>
            {props.config.showWarnings && current().warnings.length > 0 ? (
              <box flexDirection="column" flexShrink={0}>
                <text fg={props.theme.text.feedback.warning.base} wrapMode="none">
                  {`! ${current().warnings.length} warnings`}
                </text>
                <For each={current().warnings.slice(0, 2)}>
                  {(warning) => (
                    <text fg={props.theme.text.feedback.warning.base} wrapMode="none" truncate>
                      {`  ${warning}`}
                    </text>
                  )}
                </For>
              </box>
            ) : null}
            {props.config.showUpdated ? (
              <text fg={props.theme.text.faint} wrapMode="none">
                {`Updated ${formatTimestamp(props.refreshedAt ?? current().generatedAt)}`}
              </text>
            ) : null}
          </>
        )}
      </Show>
    </box>
  )
}

export interface SidebarData {
  config: SidebarConfig
  configError?: Error
  configDiagnostics: string[]
  report?: ReportView
  reportError?: Error
  quota?: QuotaView
  quotaError?: Error
}

/**
 * One refresh cycle: reload the config, then fetch report and quota in parallel only when the
 * sidebar is enabled. Kept separate from the resource so the loading rules can be unit-tested
 * without rendering.
 */
export async function loadSidebarData(input: {
  context: Plugin.Context
  sessionID: string
  loadConfig: () => Promise<{ value: SidebarConfig; diagnostics: string[] }>
}): Promise<SidebarData> {
  let config: SidebarConfig
  let configError: Error | undefined
  let configDiagnostics: string[] = []
  try {
    const loaded = await input.loadConfig()
    config = loaded.value
    configDiagnostics = loaded.diagnostics
  } catch (failure) {
    configError = toError(failure)
    config = DEFAULT_SIDEBAR_CONFIG
  }
  if (!config.enabled) return { config, configError, configDiagnostics }

  const directory = input.context.data.session.get(input.sessionID)?.location.directory
  const [reportResult, quotaResult] = await Promise.allSettled([
    input.context.client
      .rpc(TallyRpc)
      .report({ sessionID: input.sessionID }, directory ? { location: { directory } } : undefined) as Promise<ReportView>,
    input.context.client.rpc(TallyRpc).quota({}) as Promise<QuotaView>,
  ])
  return {
    config,
    configError,
    configDiagnostics,
    report: reportResult.status === "fulfilled" ? reportResult.value : undefined,
    reportError: reportResult.status === "rejected" ? toError(reportResult.reason) : undefined,
    quota: quotaResult.status === "fulfilled" ? quotaResult.value : undefined,
    quotaError: quotaResult.status === "rejected" ? toError(quotaResult.reason) : undefined,
  }
}

export interface SidebarProps {
  context: Plugin.Context
  sessionID: string
}

/**
 * Container: one resource per refresh cycle loads the config, then (only when enabled) fetches
 * report and quota in parallel. Every refetch re-reads the config and reschedules the timer.
 */
export function Sidebar(props: SidebarProps): JSX.Element {
  const theme = props.context.theme
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const [refreshedAt, setRefreshedAt] = createSignal<number>()
  const [data, { refetch }] = createResource(
    () => props.sessionID,
    async (sessionID) => {
      const loaded = await loadSidebarData({ context: props.context, sessionID, loadConfig: loadSidebarConfig })
      // Reflect when the sidebar actually refreshed, not when the cached report was generated.
      setRefreshedAt(Date.now())
      return loaded
    }
  )

  const schedule = () => {
    if (disposed) return
    if (timer !== undefined) clearTimeout(timer)
    // The config loader enforces the 15s minimum; don't duplicate that rule here.
    const seconds = data()?.config.refreshSeconds ?? DEFAULT_SIDEBAR_CONFIG.refreshSeconds
    timer = setTimeout(() => {
      if (!disposed) void refetch()
    }, seconds * 1000)
  }

  // Reschedule after every completed load, so config edits (including interval edits) apply.
  createEffect(() => {
    if (data()) schedule()
  })

  onCleanup(() => {
    disposed = true
    if (timer !== undefined) clearTimeout(timer)
  })

  // Refresh when the session settles, in addition to the interval timer.
  const status = createMemo(() => props.context.data.session.status(props.sessionID))
  createEffect(
    on(
      status,
      (current, previous) => {
        if (previous === "running" && current === "idle") void refetch()
      },
      { defer: true }
    )
  )

  const current = () => data()
  return (
    <box flexDirection="column" flexShrink={0}>
      <Show when={current()?.configError}>
        {(error) => (
          <text fg={theme.text.feedback.warning.base} wrapMode="none">
            {`Config error: ${error().message}`}
          </text>
        )}
      </Show>
      <Show when={current()?.config.enabled ?? true}>
        <SidebarView
          report={current()?.report}
          quota={current()?.quota}
          theme={theme}
          config={current()?.config ?? DEFAULT_SIDEBAR_CONFIG}
          width={TARGET_WIDTH}
          loading={data.loading}
          configDiagnostics={current()?.configDiagnostics}
          error={current()?.reportError ?? (data.error ? toError(data.error) : undefined)}
          quotaError={current()?.quotaError}
          refreshedAt={refreshedAt()}
        />
      </Show>
    </box>
  )
}
