// Dependency-free JSONC parser: strips comments and trailing commas, then delegates to JSON.parse.
// Malformed input still raises a SyntaxError.

function stripComments(text: string): string {
  let output = ""
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!

    if (inString) {
      output += char
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
      output += char
      continue
    }

    if (char === "/" && text[i + 1] === "/") {
      i += 2
      while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i++
      i-- // let the loop copy the terminating newline, if any
      continue
    }

    if (char === "/" && text[i + 1] === "*") {
      i += 2
      let closed = false
      while (i < text.length) {
        if (text[i] === "*" && text[i + 1] === "/") {
          i++
          closed = true
          break
        }
        i++
      }
      if (!closed) throw new SyntaxError("Unterminated block comment in JSONC")
      continue
    }

    output += char
  }

  return output
}

function stripTrailingCommas(text: string): string {
  let output = ""
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!

    if (inString) {
      output += char
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
      output += char
      continue
    }

    if (char === ",") {
      let next = i + 1
      while (next < text.length && /\s/.test(text[next]!)) next++
      if (text[next] === "}" || text[next] === "]") continue
    }

    output += char
  }

  return output
}

export function parseJsonc(text: string): unknown {
  return JSON.parse(stripTrailingCommas(stripComments(text)))
}
