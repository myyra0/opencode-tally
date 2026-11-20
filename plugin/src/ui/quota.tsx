/* @jsxImportSource @opentui/solid */
// One quota block renderer for the panel and the sidebar. The panel opts into absolute reset
// times and exact widths; the sidebar keeps the countdown and compact columns.

import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import type { JSX } from "@opentui/solid"

import { formatQuotaText, formatTimestamp } from "../lib/quota/format.js"
import type { ProviderState, QuotaView, SidebarWindow, UsageQuota, UsageWindow } from "../lib/quota/types.js"
import { quotaUsedPercent } from "../lib/quota/usage.js"
import { barCells, formatDuration } from "./format.js"
import { Line, Row, Section, type Theme } from "./primitives.js"

const QUOTA_ERROR_MAX_LENGTH = 100

// Mirrors the text report's shortQuotaError so one long transport error cannot clip a TUI row.
function shortQuotaError(message: string): string {
  return message.length > QUOTA_ERROR_MAX_LENGTH ? `${message.slice(0, QUOTA_ERROR_MAX_LENGTH - 1)}…` : message
}

export interface QuotaSectionProps {
  view: QuotaView
  theme: Theme
  barWidth: number
  compact: boolean
  showResetTime: boolean
  labelWidth?: number
  /** Lets the label column absorb spare width instead of truncating. */
  flexLabel?: boolean
  /** Optional sidebar toggles. The panel leaves them unset and keeps both columns. */
  showBar?: boolean
  showPercent?: boolean
  /** Per-provider display settings. Only consulted in sidebar scope; the panel ignores them. */
  providerDisplays?: QuotaView["providerDisplays"]
  /** Defaults to panel, which shows every window and bar. */
  windowScope?: "sidebar" | "panel"
}

function matchesSidebarWindow(window: UsageWindow, selected: SidebarWindow): boolean {
  if (selected === "all") return true
  // The reference treats the 5h label as a rolling window regardless of its semantic kind.
  if (selected === "rolling") return window.kind === "rolling" || window.label === "5h"
  return window.kind === selected
}

function stateWindows(state: ProviderState): readonly UsageWindow[] {
  if (state.status === "ready") return state.data.windows
  if (state.status === "error") return state.previous?.windows ?? []
  return []
}

function isLineQuota(quota: UsageQuota): boolean {
  // Balances and unitized counts carry their own value; only percentage-shaped quotas get a bar.
  return quota._tag === "Balance" || quota._tag === "Unknown" || (quota._tag === "Count" && !!quota.unit)
}

function quotaColor(theme: Theme, used: number | null) {
  if (used === null) return undefined
  if (used >= 90) return theme.text.feedback.error.base
  if (used >= 70) return theme.text.feedback.warning.base
  return theme.text.feedback.success.base
}

function WindowRow(props: {
  window: UsageWindow
  theme: Theme
  barWidth: number
  compact: boolean
  showResetTime: boolean
  labelWidth: number
  flexLabel?: boolean
  now: number
  showBar: boolean
  showPercent: boolean
}): JSX.Element {
  const used = () => quotaUsedPercent(props.window.quota)
  const resetValue = () => {
    if (props.window.resetsAt === null) return ""
    const countdown = formatDuration(props.window.resetsAt - props.now, props.now)
    return props.showResetTime ? `${formatTimestamp(props.window.resetsAt)} · ${countdown}` : countdown
  }

  return isLineQuota(props.window.quota) ? (
    <Line
      theme={props.theme}
      label={props.window.label}
      labelWidth={props.labelWidth}
      flexLabel={props.flexLabel}
      value={formatQuotaText(props.window.quota)}
    />
  ) : (
    <Row
      theme={props.theme}
      label={props.window.label}
      labelWidth={props.labelWidth}
      flexLabel={props.flexLabel}
      cells={props.showBar ? barCells(used() ?? 0, props.barWidth) : undefined}
      barWidth={props.showBar ? props.barWidth : undefined}
      brackets={props.showBar}
      percent={props.showPercent ? (used() === null ? "?" : `${Math.round(used()!)}%`) : undefined}
      value={resetValue()}
      fg={quotaColor(props.theme, used())}
    />
  )
}

function ProviderBlock(props: {
  state: ProviderState
  windows: readonly UsageWindow[]
  view: QuotaView
  theme: Theme
  barWidth: number
  compact: boolean
  showResetTime: boolean
  labelWidth: number
  flexLabel?: boolean
  now: number
  showBar: boolean
  showPercent: boolean
}): JSX.Element {
  const data = () =>
    props.state.status === "ready"
      ? props.state.data
      : props.state.status === "error"
        ? props.state.previous
        : undefined

  const title = () =>
    `${props.state.label}${props.state.status === "loading" ? " loading..." : ""}${props.state.status === "ready" && props.state.stale ? " (stale)" : ""}${props.state.status === "error" && data() ? " cached" : ""}`
  const errorState = () => (props.state.status === "error" ? props.state : undefined)
  const showError = () => errorState() !== undefined && props.view.showErrors
  const errorMessage = () => errorState()?.message ?? ""

  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={props.theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none">
        {title()}
      </text>
      {showError() ? (
        <text fg={props.theme.text.feedback.error.base} wrapMode="none">
          {`! ${shortQuotaError(errorMessage())}`}
        </text>
      ) : null}
      <For each={props.windows}>
        {(window) => (
          <WindowRow
            window={window}
            theme={props.theme}
            barWidth={props.barWidth}
            compact={props.compact}
            showResetTime={props.showResetTime}
            labelWidth={props.labelWidth}
            flexLabel={props.flexLabel}
            now={props.now}
            showBar={props.showBar}
            showPercent={props.showPercent}
          />
        )}
      </For>
    </box>
  )
}

/** Renders the Quota section from a serializable QuotaView. */
export function QuotaSection(props: QuotaSectionProps): JSX.Element {
  // The snapshot time is also the natural reference for its reset countdowns, and is stable in tests.
  const now = props.view.updatedAt ?? Date.now()
  const labelWidth = () => props.labelWidth ?? (props.compact ? 12 : 24)
  const windowsFor = (state: ProviderState): readonly UsageWindow[] => {
    const all = stateWindows(state)
    if (props.windowScope !== "sidebar") return all
    const selected = props.providerDisplays?.[state.id]?.sidebarWindow ?? "all"
    return all.filter((window) => matchesSidebarWindow(window, selected))
  }
  const visible = () =>
    props.view.states
      .filter((state) => {
        if (state.status === "disabled") return false
        if (state.status !== "error") return true
        if (state.previous) return true
        // Hide error-only providers, and missing credentials in particular, like the reference.
        return props.view.showErrors && state.errorKind !== "missing_credentials"
      })
      .filter((state) => {
        if (props.windowScope !== "sidebar") return true
        // Only drop a provider when filtering removed every window; error-only providers with no
        // data keep their title and message.
        return stateWindows(state).length === 0 || windowsFor(state).length > 0
      })

  return (
    <Section theme={props.theme} title="Quota">
      <For each={visible()}>
        {(state) => (
          <ProviderBlock
            state={state}
            windows={windowsFor(state)}
            view={props.view}
            theme={props.theme}
            barWidth={props.barWidth}
            compact={props.compact}
            showResetTime={props.showResetTime}
            labelWidth={labelWidth()}
            flexLabel={props.flexLabel}
            now={now}
            showBar={
              (props.showBar ?? true) &&
              (props.windowScope !== "sidebar" || props.providerDisplays?.[state.id]?.showSidebarBar !== false)
            }
            showPercent={props.showPercent ?? true}
          />
        )}
      </For>
      {props.view.showErrors ? (
        <For each={props.view.diagnostics}>
          {(diagnostic) => (
            <text fg={props.theme.text.feedback.warning.base} wrapMode="none">
              {`! ${diagnostic}`}
            </text>
          )}
        </For>
      ) : null}
    </Section>
  )
}
