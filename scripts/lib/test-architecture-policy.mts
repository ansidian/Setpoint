import path from "node:path"
import ts from "typescript"

export interface TestArchitectureMetrics {
  localModuleMocks: Record<string, number>
  interactionAssertions: number
  interactionAssertionLines?: number[]
  mockMetadataObservations: number
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

export type PersistenceHeuristicSignal =
  | "manual-execute-fake"
  | "named-fake-database"
  | "mock-execute-observation"
  | "sql-shape-assertion"
  | "positional-db-args-assertion"

const PERSISTENCE_CONTRACT_SIGNALS = new Set<PersistenceHeuristicSignal>([
  "mock-execute-observation",
  "sql-shape-assertion",
  "positional-db-args-assertion",
])

export function hasPersistenceContractSignals(signals: PersistenceHeuristicSignal[]): boolean {
  return signals.some((signal) => PERSISTENCE_CONTRACT_SIGNALS.has(signal))
}

const LOCAL_MODULE_RE = /^(?:\.{1,2}\/|@\/)/
const INTERACTION_NAME_RE = /^toHaveBeen(?:Nth|Last)?Called(?:With|Times|Once|Before|After)?$/
const MOCK_METADATA_MEMBERS = new Set([
  "calls",
  "lastCall",
  "invocationCallOrder",
  "results",
  "settledResults",
  "instances",
  "contexts",
])
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
  const interactionAssertionLines: number[] = []
  let mockMetadataObservations = 0
  const sourceFile = ts.createSourceFile(
    "test.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const exemptionComments = collectExemptionComments(source, sourceFile)
  const mockContainerAliases = new Set<string>()

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

  function unwrapExpression(expression: ts.Expression): ts.Expression {
    let current = expression
    while (
      ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isNonNullExpression(current)
      || ts.isSatisfiesExpression(current)
    ) current = current.expression
    return current
  }

  function accessedName(node: ts.Node): string | undefined {
    if (ts.isPropertyAccessExpression(node)) return node.name.text
    if (ts.isElementAccessExpression(node)) {
      const argument = node.argumentExpression
      if (argument && ts.isStringLiteralLike(argument)) return argument.text
    }
    return undefined
  }

  function accessedObject(node: ts.Node): ts.Expression | undefined {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      return unwrapExpression(node.expression)
    }
    return undefined
  }

  function isMockContainer(expression: ts.Expression): boolean {
    const unwrapped = unwrapExpression(expression)
    if (ts.isIdentifier(unwrapped)) return mockContainerAliases.has(unwrapped.text)
    return accessedName(unwrapped) === "mock"
  }

  // Resolve simple local aliases before collecting observations so `const state =
  // vi.mocked(send).mock; state.calls` cannot evade the report. Iterate because
  // aliases can point at another statically traceable alias.
  let changed = true
  while (changed) {
    changed = false
    function collectAliases(node: ts.Node): void {
      if (
        ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.initializer
        && isMockContainer(node.initializer)
        && !mockContainerAliases.has(node.name.text)
      ) {
        mockContainerAliases.add(node.name.text)
        changed = true
      }
      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(node.left)
        && isMockContainer(node.right)
        && !mockContainerAliases.has(node.left.text)
      ) {
        mockContainerAliases.add(node.left.text)
        changed = true
      }
      ts.forEachChild(node, collectAliases)
    }
    collectAliases(sourceFile)
  }

  function isMockMetadataAccess(node: ts.Node): boolean {
    const object = accessedObject(node)
    const name = accessedName(node)
    return object !== undefined && name !== undefined
      && MOCK_METADATA_MEMBERS.has(name)
      && isMockContainer(object)
  }

  function isMockMetadataBinding(node: ts.Node): boolean {
    if (!ts.isBindingElement(node)) return false
    const bindingPattern = node.parent
    if (!ts.isObjectBindingPattern(bindingPattern)) return false
    const declaration = bindingPattern.parent
    if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) return false
    const name = node.propertyName ?? node.name
    return (ts.isIdentifier(name) || ts.isStringLiteralLike(name))
      && MOCK_METADATA_MEMBERS.has(name.text)
      && isMockContainer(declaration.initializer)
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
    ) {
      interactionAssertions += 1
      interactionAssertionLines.push(lineIndex(node) + 1)
    }

    if (
      (isMockMetadataAccess(node) || isMockMetadataBinding(node))
      && !hasConstructLocalExemption(node, INTERACTION_EXEMPTION)
    ) mockMetadataObservations += 1

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

  return {
    localModuleMocks,
    interactionAssertions,
    ...(interactionAssertionLines.length > 0 ? { interactionAssertionLines } : {}),
    mockMetadataObservations,
    exemptionViolations,
  }
}

// This is deliberately a candidate finder, not a policy verdict. It stays broad
// enough to surface hand-written database substitutes and SQL-shape coupling;
// the semantic inventory records whether each hit is persistence work or a
// reviewed false positive.
export function collectPersistenceHeuristicSignals(source: string): PersistenceHeuristicSignal[] {
  const signals = new Set<PersistenceHeuristicSignal>()
  const sourceFile = ts.createSourceFile("test.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const masked = [...source]
  function maskLiterals(node: ts.Node): void {
    if (ts.isStringLiteralLike(node) || node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      for (let index = node.getStart(sourceFile); index < node.getEnd(); index += 1) {
        if (masked[index] !== "\n" && masked[index] !== "\r") masked[index] = " "
      }
    }
    ts.forEachChild(node, maskLiterals)
  }
  maskLiterals(sourceFile)
  const code = masked.join("").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n\r]/g, " "))
  const databaseContext = /@libsql|better-sqlite/.test(source)
    || /\b(?:db|database)Client\b|\b(?:mock|fake)Db\b|\.execute\b|\b[\w$]*(?:Sql|SQL|Row)Query\b|\.sql\b/.test(code)

  if (/\bexecute\s*:\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(code)) {
    signals.add("manual-execute-fake")
  }
  if (/\b(?:mock|fake)[\w$]*(?:db|database)\b|\b(?:db|database)[\w$]*(?:mock|fake)\b/i.test(code)) {
    signals.add("named-fake-database")
  }
  if (/\.execute\.mock\.(?:calls|lastCall|invocationCallOrder|results|settledResults|instances|contexts)\b/.test(code)) {
    signals.add("mock-execute-observation")
  }
  if (/expect\s*\([^\n]*(?:\.sql\b|\bsql\b)[^\n]*\)\s*\.(?:toBe|toEqual|toContain|toMatch)/.test(code)) {
    signals.add("sql-shape-assertion")
  }
  if (databaseContext && /expect\s*\([^\n]*(?:\.args\b|\bargs(?:\[|\.|\b))[^\n]*\)\s*\.(?:toBe|toEqual|toContain|toMatch)/.test(code)) {
    signals.add("positional-db-args-assertion")
  }

  return [...signals].sort()
}

export function checkTestArchitectureMetrics(
  files: Record<string, TestArchitectureMetrics>,
): TestArchitectureCheckResult {
  const failures: string[] = []
  const warnings: string[] = []
  for (const [file, metrics] of Object.entries(files)) {
    for (const violation of metrics.exemptionViolations ?? []) {
      failures.push(`${file}: ${violation}`)
    }
    for (const [target, count] of Object.entries(metrics.localModuleMocks)) {
      failures.push(`${file} mocks local module ${target} ${count} time(s); mock external boundaries instead`)
    }
    if (metrics.interactionAssertions > 0) {
      const lineDetail = metrics.interactionAssertionLines?.length
        ? ` at line${metrics.interactionAssertionLines.length === 1 ? "" : "s"} ${metrics.interactionAssertionLines.join(", ")}`
        : ""
      warnings.push(
        `${file} has ${metrics.interactionAssertions} reviewable interaction assertion(s)${lineDetail}; prefer observable results, or add an exact test-architecture boundary rationale when the interaction is the unavoidable contract`,
      )
    }
  }
  return { failures, warnings }
}

export function checkTestArchitectureMockMetadataObservations(
  files: Record<string, TestArchitectureMetrics>,
): string[] {
  return Object.entries(files).flatMap(([file, metrics]) => (
    metrics.mockMetadataObservations > 0
      ? [`${file} has ${metrics.mockMetadataObservations} unreviewed mock-metadata observation(s); remove them or add exact construct-local boundary rationales`]
      : []
  ))
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

export function normalizeTestArchitecturePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").split(path.sep).join("/")
}
