import path from "node:path"
import ts from "typescript"

export interface TestArchitectureMetrics {
  localModuleMocks: Record<string, number>
  interactionAssertions: number
  exemptionViolations?: string[]
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

interface ExemptionComment {
  marker: string
  lineIndex: number
  targetLineIndex: number
  reason: string
  uses: number
}

function collectExemptionComments(source: string, sourceFile: ts.SourceFile): ExemptionComment[] {
  const comments: ExemptionComment[] = []
  const literalRanges: Array<{ pos: number; end: number }> = []

  function collectLiteralRanges(node: ts.Node): void {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteral(node)) {
      literalRanges.push({ pos: node.getStart(sourceFile), end: node.getEnd() })
    }
    ts.forEachChild(node, collectLiteralRanges)
  }
  collectLiteralRanges(sourceFile)

  for (const marker of [MOCK_EXEMPTION, INTERACTION_EXEMPTION]) {
    let markerIndex = source.indexOf(marker)
    while (markerIndex >= 0) {
      const insideLiteral = literalRanges.some(({ pos, end }) => markerIndex >= pos && markerIndex < end)
      const lineStart = source.lastIndexOf("\n", markerIndex - 1) + 1
      const commentStart = source.lastIndexOf("//", markerIndex)
      if (!insideLiteral && commentStart >= lineStart) {
        const lineEnd = source.indexOf("\n", markerIndex)
        const commentEnd = lineEnd >= 0 ? lineEnd : source.length
        const lineIndex = sourceFile.getLineAndCharacterOfPosition(commentStart).line
        const isTrailingComment = source.slice(lineStart, commentStart).trim().length > 0
        const text = source.slice(commentStart, commentEnd)
        const markerInComment = markerIndex - commentStart
        comments.push({
          marker,
          lineIndex,
          targetLineIndex: isTrailingComment ? lineIndex : lineIndex + 1,
          reason: text.slice(markerInComment + marker.length).trim(),
          uses: 0,
        })
      }
      markerIndex = source.indexOf(marker, markerIndex + marker.length)
    }
  }
  return comments
}

export function collectTestArchitectureMetrics(source: string): TestArchitectureMetrics {
  const localModuleMocks: Record<string, number> = {}
  let interactionAssertions = 0
  const sourceFile = ts.createSourceFile(
    "test.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const exemptionComments = collectExemptionComments(source, sourceFile)

  function lineIndex(node: ts.Node): number {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line
  }

  function hasConstructLocalExemption(node: ts.Node, marker: string): boolean {
    const constructLine = lineIndex(node)
    const candidates = exemptionComments.filter(
      (comment) => comment.marker === marker
        && comment.targetLineIndex === constructLine,
    )
    for (const candidate of candidates) candidate.uses += 1
    const candidate = candidates[0]
    return candidates.length === 1 && candidate !== undefined && candidate.reason.length > 0
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
      && !hasConstructLocalExemption(node, MOCK_EXEMPTION)
    ) localModuleMocks[firstArgument.text] = (localModuleMocks[firstArgument.text] ?? 0) + 1

    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && INTERACTION_NAME_RE.test(node.expression.name.text)
      && !hasConstructLocalExemption(node, INTERACTION_EXEMPTION)
    ) interactionAssertions += 1

    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  const exemptionViolations = exemptionComments.flatMap((comment) => {
    const line = comment.lineIndex + 1
    if (comment.reason.length === 0) return [`line ${line} has an empty test-architecture boundary rationale`]
    if (comment.uses === 0) return [`line ${line} has a test-architecture exemption that is not beside its exact construct`]
    if (comment.uses > 1) return [`line ${line} applies one test-architecture exemption to ${comment.uses} constructs`]
    return []
  })

  return { localModuleMocks, interactionAssertions, exemptionViolations }
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
  for (const [file, metrics] of Object.entries(files)) {
    for (const violation of metrics.exemptionViolations ?? []) {
      failures.push(`${file}: ${violation}`)
    }
  }
  checkLocalModuleMocks(files, baseline.localModuleMocks, failures, warnings)
  checkInteractionAssertions(files, baseline.interactionAssertions, failures, warnings)
  return { failures, warnings }
}

export function checkTestArchitectureApprovalsEmpty(approvals: TestArchitectureApprovals): string[] {
  const entries = [
    ...Object.keys(approvals.interactionAssertions),
    ...Object.keys(approvals.localModuleMocks),
  ]
  return entries.length === 0
    ? []
    : ["test-architecture baseline approvals must remain empty; use construct-local boundary rationales"]
}

export function checkTestArchitectureBaselineEmpty(baseline: TestArchitectureBaseline): string[] {
  const entries = [
    ...Object.keys(baseline.interactionAssertions),
    ...Object.keys(baseline.localModuleMocks),
  ]
  return entries.length === 0
    ? []
    : ["test-architecture baseline must remain empty; aggregate grandfathered allowances are forbidden"]
}

export function checkTestArchitectureBaselineGrowth({
  previousBaseline,
  baseline,
}: {
  previousBaseline: TestArchitectureBaseline
  baseline: TestArchitectureBaseline
}): string[] {
  const failures: string[] = []

  for (const [file, current] of Object.entries(baseline.interactionAssertions)) {
    const previous = previousBaseline.interactionAssertions[file] ?? 0
    if (current > previous) {
      failures.push(
        `${file} raises the interactionAssertions baseline from ${previous} to ${current}; the debt-elimination campaign is shrink-only`,
      )
    }
  }

  for (const [file, targets] of Object.entries(baseline.localModuleMocks)) {
    for (const [target, current] of Object.entries(targets)) {
      const previous = previousBaseline.localModuleMocks[file]?.[target] ?? 0
      if (current > previous) {
        failures.push(
          `${file} raises the local mock baseline for ${target} from ${previous} to ${current}; the debt-elimination campaign is shrink-only`,
        )
      }
    }
  }

  return failures
}

export function normalizeTestArchitecturePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").split(path.sep).join("/")
}
