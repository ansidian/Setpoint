import * as ts from "typescript"

export type TestSourcePolicyViolationKind =
  | "exclusive-or-disabled-test"
  | "fixed-duration-sleep"
  | "full-calendar-test-harness"

export interface TestSourcePolicyViolation {
  kind: TestSourcePolicyViolationKind
  line: number
  column: number
  message: string
}

const vitestCaseFactories = new Set(["bench", "describe", "it", "suite", "test"])
const forbiddenCaseModifiers = new Set(["only", "skip", "todo"])
const reviewedFullCalendarTestOwners = new Set([
  "src/components/calendar/CalendarDeadlineQuickActions.test.tsx",
  "src/components/calendar/CalendarEventEditor.assist.test.tsx",
  "src/components/calendar/CalendarEventEditor.ghost-preview.test.tsx",
  "src/components/calendar/CalendarEventEditor.quick-actions.test.tsx",
  "src/components/calendar/CalendarEventEditor.test.tsx",
  "src/components/calendar/CalendarModal.agenda-rail.test.tsx",
  "src/components/calendar/CalendarModal.agenda-scroll.test.tsx",
  "src/components/calendar/CalendarModal.agenda-today.test.tsx",
  "src/components/calendar/CalendarModal.bills.test.tsx",
  "src/components/calendar/CalendarModal.dashboard-focus.test.tsx",
  "src/components/calendar/CalendarModal.deadline-overlay.test.tsx",
  "src/components/calendar/CalendarModal.events.test.tsx",
  "src/components/calendar/CalendarModal.layout.test.tsx",
  "src/components/calendar/CalendarModal.mini-calendar.test.tsx",
  "src/components/calendar/CalendarModal.search-workflow.test.tsx",
  "src/components/calendar/CalendarModal.todoist-deadlines.test.tsx",
  "src/components/calendar/CalendarModal.todoist-editor.test.tsx",
  "src/components/calendar/CalendarModal.workspace-create.test.tsx",
  "src/components/calendar/CalendarModal.workspace-edit.test.tsx",
  "src/components/calendar/CalendarModal.workspace-parking.test.tsx",
])

function normalizeFilePath(filePath: string): string {
  return filePath.replaceAll("\\", "/")
}

function isFullCalendarTestHarnessImport(node: ts.ImportDeclaration): boolean {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return false
  const modulePath = node.moduleSpecifier.text.replaceAll("\\", "/")
  return /(?:^|\/)CalendarModal(?:\.tsx)?$/.test(modulePath)
    || (
      /(?:^|\/)CalendarEventEditor\.test-utils(?:\.tsx)?$/.test(modulePath)
      && !/(?:^|\/)events\/CalendarEventEditor\.test-utils(?:\.tsx)?$/.test(modulePath)
    )
}

function propertyName(expression: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  if (
    ts.isElementAccessExpression(expression)
    && expression.argumentExpression
    && ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return expression.argumentExpression.text
  }
  return null
}

function rootIdentifierName(expression: ts.Expression): string | null {
  let current = expression
  while (true) {
    if (ts.isIdentifier(current)) return current.text
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = current.expression
      continue
    }
    if (ts.isCallExpression(current)) {
      current = current.expression
      continue
    }
    if (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression
      continue
    }
    return null
  }
}

function collectVitestCaseFactoryNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set(vitestCaseFactories)

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== "vitest"
    ) continue

    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue

    for (const element of bindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text
      if (vitestCaseFactories.has(importedName)) names.add(element.name.text)
    }
  }

  return names
}

function isPromiseConstructor(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return expression.text === "Promise"
  return ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === "globalThis"
    && expression.name.text === "Promise"
}

function isSetTimeoutCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false
  if (ts.isIdentifier(node.expression)) return node.expression.text === "setTimeout"
  return propertyName(node.expression) === "setTimeout"
}

function isZeroDelay(expression: ts.Expression | undefined): boolean {
  if (!expression) return true
  if (ts.isParenthesizedExpression(expression)) return isZeroDelay(expression.expression)
  if (ts.isNumericLiteral(expression)) return Number(expression.text) === 0
  if (
    ts.isPrefixUnaryExpression(expression)
    && expression.operator === ts.SyntaxKind.PlusToken
  ) return isZeroDelay(expression.operand)
  return false
}

function awaitedPromiseHasElapsedTimer(node: ts.AwaitExpression): boolean {
  const expression = node.expression
  if (
    !ts.isNewExpression(expression)
    || !isPromiseConstructor(expression.expression)
    || !expression.arguments?.length
  ) return false

  const executor = expression.arguments[0]
  if (!executor || (!ts.isArrowFunction(executor) && !ts.isFunctionExpression(executor))) {
    return false
  }

  let hasElapsedTimer = false
  function visit(current: ts.Node): void {
    if (hasElapsedTimer) return
    if (isSetTimeoutCall(current) && !isZeroDelay(current.arguments[1])) {
      hasElapsedTimer = true
      return
    }
    ts.forEachChild(current, visit)
  }
  visit(executor.body)
  return hasElapsedTimer
}

export function findTestSourcePolicyViolations(
  source: string,
  filePath = "test.ts",
): TestSourcePolicyViolation[] {
  const scriptKind = filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  )
  const caseFactoryNames = collectVitestCaseFactoryNames(sourceFile)
  const violations: TestSourcePolicyViolation[] = []

  function report(
    node: ts.Node,
    kind: TestSourcePolicyViolationKind,
    message: string,
  ): void {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    violations.push({
      kind,
      line: position.line + 1,
      column: position.character + 1,
      message,
    })
  }

  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node)
      && isFullCalendarTestHarnessImport(node)
      && !reviewedFullCalendarTestOwners.has(normalizeFilePath(filePath))
    ) {
      report(
        node,
        "full-calendar-test-harness",
        "new tests must use a stable Calendar behavior facade or a genuine pure algorithm contract instead of mounting the full CalendarModal workspace",
      )
    }

    if (ts.isCallExpression(node)) {
      const modifier = propertyName(node.expression)
      const rootName = rootIdentifierName(node.expression)
      if (
        modifier
        && forbiddenCaseModifiers.has(modifier)
        && rootName
        && caseFactoryNames.has(rootName)
      ) {
        report(
          node,
          "exclusive-or-disabled-test",
          `Vitest .${modifier} cases must not be committed`,
        )
      }
    }

    if (ts.isAwaitExpression(node) && awaitedPromiseHasElapsedTimer(node)) {
      report(
        node,
        "fixed-duration-sleep",
        "awaited non-zero timers must use controlled promises, fake clocks, or observable state",
      )
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations
}
