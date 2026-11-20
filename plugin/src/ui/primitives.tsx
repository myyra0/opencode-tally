/* @jsxImportSource @opentui/solid */
// Shared TUI building blocks so a label, bar, percentage, and value row means the same thing
// on every surface. Colors come only from the host theme; `Theme` is the subset it exposes.

import { TextAttributes, type RGBA } from "@opentui/core"
import { For } from "solid-js"
import type { JSX } from "@opentui/solid"

export interface Theme {
  readonly categorical: ReadonlyArray<{ readonly 200: RGBA }>
  readonly text: {
    readonly base: RGBA
    readonly muted: RGBA
    readonly faint: RGBA
    readonly feedback: {
      readonly error: { readonly base: RGBA }
      readonly success: { readonly base: RGBA }
      readonly warning: { readonly base: RGBA }
    }
  }
}

export interface BarCells {
  readonly filled: number
  readonly empty: number
}

/** The host's first categorical accent, falling back to base text. */
export function accent(theme: Theme): RGBA {
  return theme.categorical[0]?.[200] ?? theme.text.base
}

export function Bar(props: {
  theme: Theme
  cells: BarCells
  width: number
  fg?: RGBA
}): JSX.Element {
  return (
    <box flexDirection="row" width={props.width}>
      <text fg={props.fg ?? accent(props.theme)} selectable={false}>
        {"█".repeat(props.cells.filled)}
      </text>
      <text fg={props.theme.text.faint} selectable={false}>
        {"░".repeat(props.cells.empty)}
      </text>
    </box>
  )
}

export function Row(props: {
  theme: Theme
  label: string
  labelWidth?: number
  cells?: BarCells
  barWidth?: number
  brackets?: boolean
  fg?: RGBA
  percent?: string
  value?: string
  valueWidth?: number
  suffix?: string
  detail?: readonly string[]
  strong?: boolean
}): JSX.Element {
  const value = () => {
    const text = props.value ?? ""
    const width = props.valueWidth ?? 10
    return text.length < width ? text.padStart(width) : text
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" gap={1} height={1}>
        <text fg={props.theme.text.muted} width={props.labelWidth ?? 24} wrapMode="none" truncate>
          {props.label}
        </text>
        {props.cells && props.barWidth !== undefined ? (
          <box flexDirection="row" flexShrink={0}>
            {props.brackets ? (
              <text fg={props.theme.text.faint} selectable={false}>
                {"["}
              </text>
            ) : null}
            <Bar theme={props.theme} cells={props.cells} width={props.barWidth} fg={props.fg} />
            {props.brackets ? (
              <text fg={props.theme.text.faint} selectable={false}>
                {"]"}
              </text>
            ) : null}
          </box>
        ) : null}
        {props.suffix ?? props.percent ? (
          <text fg={props.theme.text.muted} width={7} wrapMode="none">
            {(props.suffix ?? props.percent)!.padStart(6)}
          </text>
        ) : null}
        <text
          fg={props.theme.text.base}
          attributes={props.strong ? TextAttributes.BOLD : TextAttributes.NONE}
          width={props.valueWidth}
          wrapMode="none"
        >
          {value()}
        </text>
      </box>
      <For each={props.detail ?? []}>
        {(line) => (
          <text fg={props.theme.text.faint} wrapMode="none" truncate>
            {`  → ${line}`}
          </text>
        )}
      </For>
    </box>
  )
}

export function Line(props: {
  theme: Theme
  label: string
  value: string
  labelWidth?: number
  strong?: boolean
}): JSX.Element {
  return (
    <box flexDirection="row" gap={1} height={1}>
      <text fg={props.theme.text.muted} width={props.labelWidth ?? 24} wrapMode="none" truncate>
        {props.label}
      </text>
      <text
        fg={props.theme.text.base}
        attributes={props.strong ? TextAttributes.BOLD : TextAttributes.NONE}
        wrapMode="none"
      >
        {props.value}
      </text>
    </box>
  )
}

export function Section(props: {
  theme: Theme
  title: string
  note?: string
  children?: JSX.Element
}): JSX.Element {
  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" gap={1}>
        <text fg={props.theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none">
          {props.title}
        </text>
        {props.note ? (
          <text fg={props.theme.text.faint} wrapMode="none">
            {props.note}
          </text>
        ) : null}
      </box>
      {props.children}
    </box>
  )
}
