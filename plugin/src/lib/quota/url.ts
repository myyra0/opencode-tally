// Validates configured provider base URLs before a credentialed request is sent.

const isLoopbackHost = (hostname: string): boolean => {
  const host =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname

  return (
    host === "localhost" ||
    host === "::1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host)
  )
}

/**
 * Resolves a base URL to an absolute HTTPS URL (HTTP only for loopback hosts).
 * Invalid or unexpected values fall back to the default so credentials are never
 * sent to an untrusted origin.
 */
export function resolveHttpsBaseUrl(
  baseUrl: string | undefined,
  defaultUrl: string
): string {
  const fallback = defaultUrl.replace(/\/$/u, "")
  let parsed: URL

  try {
    parsed = new URL((baseUrl ?? defaultUrl).trim())
  } catch {
    return fallback
  }

  if (parsed.username !== "" || parsed.password !== "") {
    return fallback
  }

  const allowed =
    parsed.protocol === "https:" ||
    (isLoopbackHost(parsed.hostname) && parsed.protocol === "http:")

  return allowed ? parsed.toString().replace(/\/$/u, "") : fallback
}
