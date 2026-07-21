import { afterEach, beforeEach } from "vitest"

type GuardedConsoleMethod = "error" | "warn"

interface UnexpectedConsoleCall {
  method: GuardedConsoleMethod
  args: unknown[]
}

const unexpectedConsoleCalls: UnexpectedConsoleCall[] = []

function formatConsoleArgument(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const guardedConsole = {
  error: (...args: unknown[]) => {
    unexpectedConsoleCalls.push({ method: "error", args })
  },
  warn: (...args: unknown[]) => {
    unexpectedConsoleCalls.push({ method: "warn", args })
  },
} satisfies Record<GuardedConsoleMethod, (...args: unknown[]) => void>

const nativeFetch = globalThis.fetch.bind(globalThis)

export const guardedFetch: typeof fetch = async (input, init) => {
  const target = input instanceof Request ? input.url : String(input)
  const url = new URL(target, "http://vitest.invalid")
  if (
    url.protocol === "http:"
    && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  ) {
    return nativeFetch(input, init)
  }
  throw new Error(
    `Unexpected network request in Vitest: ${target}. Stub fetch at the provider boundary.`,
  )
}

function installConsoleGuardrails(): void {
  console.error = guardedConsole.error
  console.warn = guardedConsole.warn
}

// Install before test modules evaluate so top-level captures of fetch retain the
// fail-closed implementation rather than Node's live network client.
installConsoleGuardrails()
globalThis.fetch = guardedFetch

beforeEach(() => {
  unexpectedConsoleCalls.length = 0
  installConsoleGuardrails()
})

afterEach(() => {
  // Local spies own expected error-path output. Anything that reaches these
  // guards is unexpected and must fail instead of disappearing into global noise.
  const calls = unexpectedConsoleCalls.splice(0)
  if (calls.length === 0) return

  const details = calls
    .map(({ method, args }) => `console.${method}: ${args.map(formatConsoleArgument).join(" ")}`)
    .join("\n")
  throw new Error(`Unexpected console output in Vitest:\n${details}`)
})
