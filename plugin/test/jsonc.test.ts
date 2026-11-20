import { expect, test } from "bun:test"

import { parseJsonc } from "../src/lib/jsonc.ts"

test("strips line comments and trailing commas", () => {
  expect(parseJsonc('{ "a": 1, // note\n "b": 2, }')).toEqual({ a: 1, b: 2 })
})

test("does not treat // inside strings as a comment", () => {
  expect(parseJsonc('{ "url": "https://x//y", "a": 1 }')).toEqual({ url: "https://x//y", a: 1 })
})

test("strips block comments", () => {
  expect(parseJsonc('{ /* block */ "a": 1 }')).toEqual({ a: 1 })
})
