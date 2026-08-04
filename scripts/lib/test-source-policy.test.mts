import { describe, expect, it } from "vitest"
import { findTestSourcePolicyViolations } from "./test-source-policy.mts"

describe("findTestSourcePolicyViolations", () => {
  it("reports disabled and exclusive Vitest cases, including imported aliases", () => {
    const source = [
      'import { describe, test as check } from "vitest"',
      'describe.only("focused", () => {})',
      'check.skip("disabled", () => {})',
      'test.todo("unfinished")',
    ].join("\n")

    expect(findTestSourcePolicyViolations(source, "example.test.ts")).toEqual([
      expect.objectContaining({ kind: "exclusive-or-disabled-test", line: 2 }),
      expect.objectContaining({ kind: "exclusive-or-disabled-test", line: 3 }),
      expect.objectContaining({ kind: "exclusive-or-disabled-test", line: 4 }),
    ])
  })

  it("reports awaited timers that make a test wait for elapsed wall-clock time", () => {
    const source = [
      'await new Promise((resolve) => setTimeout(resolve, 25))',
      'await new Promise((resolve) => window.setTimeout(resolve, delayMs))',
    ].join("\n")

    expect(findTestSourcePolicyViolations(source, "example.test.ts")).toEqual([
      expect.objectContaining({ kind: "fixed-duration-sleep", line: 1 }),
      expect.objectContaining({ kind: "fixed-duration-sleep", line: 2 }),
    ])
  })

  it("allows zero-delay event-loop yields and timer-driven behavior that is not awaited as a sleep", () => {
    const source = [
      'await new Promise((resolve) => setTimeout(resolve, 0))',
      'const timer = window.setTimeout(onReady, targetReadyDelayMs)',
      'vi.advanceTimersByTime(50)',
      'test("ordinary case", () => {})',
    ].join("\n")

    expect(findTestSourcePolicyViolations(source, "example.test.ts")).toEqual([])
  })

  it("does not confuse unrelated methods with Vitest case modifiers", () => {
    const source = [
      'queue.skip()',
      'document.body.classList.toggle("only")',
      'describe("ordinary suite", () => {})',
    ].join("\n")

    expect(findTestSourcePolicyViolations(source, "example.test.ts")).toEqual([])
  })

  it("rejects new tests that mount the root calendar workspace", () => {
    const source = [
      'import CalendarModal from "./CalendarModal.tsx"',
      'import { renderModal } from "./CalendarEventEditor.test-utils.tsx"',
    ].join("\n")

    expect(findTestSourcePolicyViolations(
      source,
      "src/components/calendar/NewCalendarBehavior.test.tsx",
    )).toEqual([
      expect.objectContaining({ kind: "full-calendar-test-harness", line: 1 }),
      expect.objectContaining({ kind: "full-calendar-test-harness", line: 2 }),
    ])
  })

  it("allows reviewed cross-layer calendar test owners", () => {
    const source = 'import CalendarModal from "./CalendarModal.tsx"'

    expect(findTestSourcePolicyViolations(
      source,
      "src/components/calendar/CalendarModal.events.test.tsx",
    )).toEqual([])
  })

  it("does not preserve deleted Calendar owners in the reviewed allowlist", () => {
    const source = 'import CalendarModal from "../../components/calendar/CalendarModal.tsx"'

    expect(findTestSourcePolicyViolations(
      source,
      "src/hooks/calendar/useCalendarModalHotkeys.test.tsx",
    )).toEqual([
      expect.objectContaining({ kind: "full-calendar-test-harness", line: 1 }),
    ])
  })

  it("allows the focused event-editor harness without review", () => {
    const source = 'import { renderEventEditor } from "./events/CalendarEventEditor.test-utils.tsx"'

    expect(findTestSourcePolicyViolations(
      source,
      "src/components/calendar/NewEditorBehavior.test.tsx",
    )).toEqual([])
  })
})
