import path from "node:path"
import ts from "typescript"

export interface TestArchitectureMetrics {
  localModuleMocks: Record<string, number>
  interactionAssertions: number
}

export interface TestArchitectureBaseline {
  localModuleMocks: Record<string, Record<string, number>>
  interactionAssertions: Record<string, number>
}

export interface TestArchitectureCheckResult {
  failures: string[]
  warnings: string[]
}

export interface TestArchitectureApproval {
  from: number
  to: number
  approvedBy: string
  reason: string
}

export interface TestArchitectureApprovals {
  localModuleMocks: Record<string, Record<string, TestArchitectureApproval>>
  interactionAssertions: Record<string, TestArchitectureApproval>
}

const LOCAL_MODULE_RE = /^(?:\.{1,2}\/|@\/)/
const INTERACTION_NAME_RE = /^toHaveBeen(?:Nth|Last)?Called(?:With|Times|Once|Before|After)?$/
const MOCK_EXEMPTION = "test-architecture: allow-boundary-mock --"
const INTERACTION_EXEMPTION = "test-architecture: allow-boundary-interaction --"

function normalizedLines(source: string): string[] {
  return source.replaceAll("\r\n", "\n").split("\n")
}

function hasReasonedExemption(lines: string[], lineIndex: number, marker: string): boolean {
  const candidates = [lines[lineIndex], lines[lineIndex - 1]].filter(
    (line): line is string => typeof line === "string",
  )
  return candidates.some((line) => {
    const markerIndex = line.indexOf(marker)
    return markerIndex >= 0 && line.slice(markerIndex + marker.length).trim().length > 0
  })
}

export function collectTestArchitectureMetrics(source: string): TestArchitectureMetrics {
  const lines = normalizedLines(source)
  const localModuleMocks: Record<string, number> = {}
  let interactionAssertions = 0
  const sourceFile = ts.createSourceFile(
    "test.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )

  function lineIndex(node: ts.Node): number {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line
  }

  function visit(node: ts.Node): void {
    const firstArgument = ts.isCallExpression(node) ? node.arguments[0] : undefined
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === "vi"
      && ["mock", "doMock"].includes(node.expression.name.text)
      && firstArgument !== undefined
      && ts.isStringLiteralLike(firstArgument)
      && LOCAL_MODULE_RE.test(firstArgument.text)
      && !hasReasonedExemption(lines, lineIndex(node), MOCK_EXEMPTION)
    ) localModuleMocks[firstArgument.text] = (localModuleMocks[firstArgument.text] ?? 0) + 1

    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && INTERACTION_NAME_RE.test(node.expression.name.text)
      && !hasReasonedExemption(lines, lineIndex(node), INTERACTION_EXEMPTION)
    ) interactionAssertions += 1

    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return { localModuleMocks, interactionAssertions }
}

function checkInteractionAssertions(
  files: Record<string, TestArchitectureMetrics>,
  baseline: Record<string, number>,
  failures: string[],
  warnings: string[],
): void {
  for (const [file, metrics] of Object.entries(files)) {
    const actual = metrics.interactionAssertions
    const allowed = baseline[file] ?? 0
    if (actual > allowed) {
      failures.push(`${file} has ${actual} interactionAssertions, above the test-architecture baseline allowance ${allowed}`)
    } else if (actual < allowed) {
      warnings.push(`${file} reduced interactionAssertions from ${allowed} to ${actual}; ratchet the test-architecture baseline down`)
    }
  }

  for (const file of Object.keys(baseline)) {
    if (!files[file]) warnings.push(`${file} is stale in the interactionAssertions test-architecture baseline`)
  }
}

function checkLocalModuleMocks(
  files: Record<string, TestArchitectureMetrics>,
  baseline: Record<string, Record<string, number>>,
  failures: string[],
  warnings: string[],
): void {
  for (const [file, metrics] of Object.entries(files)) {
    const allowedTargets = baseline[file] ?? {}
    for (const [target, actual] of Object.entries(metrics.localModuleMocks)) {
      const allowed = allowedTargets[target] ?? 0
      if (actual > allowed) {
        failures.push(`${file} mocks ${target} ${actual} time(s), above the test-architecture baseline allowance ${allowed}`)
      }
    }
  }

  for (const [file, targets] of Object.entries(baseline)) {
    for (const [target, allowed] of Object.entries(targets)) {
      const actual = files[file]?.localModuleMocks[target] ?? 0
      if (actual < allowed) {
        warnings.push(`${file} reduced mocks of ${target} from ${allowed} to ${actual}; ratchet the test-architecture baseline down`)
      }
    }
  }
}

export function checkTestArchitectureBaseline({
  files,
  baseline,
}: {
  files: Record<string, TestArchitectureMetrics>
  baseline: TestArchitectureBaseline
}): TestArchitectureCheckResult {
  const failures: string[] = []
  const warnings: string[] = []
  checkLocalModuleMocks(files, baseline.localModuleMocks, failures, warnings)
  checkInteractionAssertions(files, baseline.interactionAssertions, failures, warnings)
  return { failures, warnings }
}

function isMatchingApproval(
  approval: TestArchitectureApproval | undefined,
  from: number,
  to: number,
): boolean {
  return approval?.from === from
    && approval.to === to
    && approval.approvedBy.trim().length > 0
    && approval.reason.trim().length > 0
}

export function checkTestArchitectureBaselineGrowth({
  previousBaseline,
  baseline,
  approvals,
}: {
  previousBaseline: TestArchitectureBaseline
  baseline: TestArchitectureBaseline
  approvals: TestArchitectureApprovals
}): string[] {
  const failures: string[] = []

  for (const [file, current] of Object.entries(baseline.interactionAssertions)) {
    const previous = previousBaseline.interactionAssertions[file] ?? 0
    if (
      current > previous
      && !isMatchingApproval(approvals.interactionAssertions[file], previous, current)
    ) {
      failures.push(
        `${file} raises the interactionAssertions baseline from ${previous} to ${current} without an exact owner approval and reason`,
      )
    }
  }

  for (const [file, targets] of Object.entries(baseline.localModuleMocks)) {
    for (const [target, current] of Object.entries(targets)) {
      const previous = previousBaseline.localModuleMocks[file]?.[target] ?? 0
      if (
        current > previous
        && !isMatchingApproval(approvals.localModuleMocks[file]?.[target], previous, current)
      ) {
        failures.push(
          `${file} raises the local mock baseline for ${target} from ${previous} to ${current} without an exact owner approval and reason`,
        )
      }
    }
  }

  return failures
}

export function normalizeTestArchitecturePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").split(path.sep).join("/")
}
