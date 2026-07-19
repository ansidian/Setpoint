import path from "node:path"
import ts from "typescript"

export interface ModuleSourceFile {
  path: string
  source: string
}

export interface UnresolvedModuleEdge {
  consumer: string
  specifier: string
}

export interface ModuleReachabilityResult {
  reachable: string[]
  exempt: string[]
  candidateUnreachable: string[]
  testOnlyTargets: string[]
  unresolvedInternalEdges: UnresolvedModuleEdge[]
  missingEntrypoints: string[]
  staleExemptions: string[]
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"] as const
const JAVASCRIPT_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs"])

function normalizeModulePath(modulePath: string): string {
  return modulePath.split(path.sep).join("/").replace(/^\.\//, "")
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) {
    return ts.ScriptKind.JS
  }
  return ts.ScriptKind.TS
}

function stringLiteralValue(node: ts.Node | undefined): string | null {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  return null
}

export function collectModuleSpecifiers(source: string, filePath: string): string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  )
  const specifiers: string[] = []

  function add(node: ts.Node | undefined): void {
    const value = stringLiteralValue(node)
    if (value !== null) specifiers.push(value)
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier)
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression)
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require")
      ) {
        add(node.arguments[0])
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return specifiers
}

function internalBasePath(consumer: string, specifier: string): string | null {
  const withoutSuffix = specifier.replace(/[?#].*$/, "")
  if (withoutSuffix.startsWith("@/")) {
    return normalizeModulePath(path.posix.join("src", withoutSuffix.slice(2)))
  }
  if (!withoutSuffix.startsWith(".")) return null
  return normalizeModulePath(path.posix.join(path.posix.dirname(consumer), withoutSuffix))
}

function sourceCandidates(basePath: string): string[] {
  const extension = path.posix.extname(basePath)
  if (SOURCE_EXTENSIONS.includes(extension as (typeof SOURCE_EXTENSIONS)[number])) {
    return [basePath]
  }
  if (JAVASCRIPT_EXTENSIONS.has(extension)) {
    const stem = basePath.slice(0, -extension.length)
    return SOURCE_EXTENSIONS.map((candidateExtension) => `${stem}${candidateExtension}`)
  }
  return [
    basePath,
    ...SOURCE_EXTENSIONS.map((candidateExtension) => `${basePath}${candidateExtension}`),
    ...SOURCE_EXTENSIONS.map((candidateExtension) => `${basePath}/index${candidateExtension}`),
  ]
}

export function resolveInternalModule({
  consumer,
  specifier,
  modulePaths,
}: {
  consumer: string
  specifier: string
  modulePaths: ReadonlySet<string>
}): string | null {
  const normalizedConsumer = normalizeModulePath(consumer)
  const basePath = internalBasePath(normalizedConsumer, specifier)
  if (!basePath) return null
  for (const candidate of sourceCandidates(basePath)) {
    if (modulePaths.has(candidate)) return candidate
  }
  return null
}

function isUnresolvedSourceSpecifier(specifier: string): boolean {
  if (!(specifier.startsWith(".") || specifier.startsWith("@/"))) return false
  const withoutSuffix = specifier.replace(/[?#].*$/, "")
  const extension = path.posix.extname(withoutSuffix)
  return !extension
    || SOURCE_EXTENSIONS.includes(extension as (typeof SOURCE_EXTENSIONS)[number])
    || JAVASCRIPT_EXTENSIONS.has(extension)
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

export function analyzeModuleReachability({
  productionFiles,
  testFiles,
  entrypoints,
  exemptions,
}: {
  productionFiles: ModuleSourceFile[]
  testFiles: ModuleSourceFile[]
  entrypoints: string[]
  exemptions: Record<string, string>
}): ModuleReachabilityResult {
  const normalizedProductionFiles = productionFiles.map((file) => ({
    path: normalizeModulePath(file.path),
    source: file.source,
  }))
  const normalizedTestFiles = testFiles.map((file) => ({
    path: normalizeModulePath(file.path),
    source: file.source,
  }))
  const modulePaths = new Set(normalizedProductionFiles.map((file) => file.path))
  const graph = new Map<string, Set<string>>()
  const unresolvedInternalEdges: UnresolvedModuleEdge[] = []

  for (const file of normalizedProductionFiles) {
    const targets = new Set<string>()
    for (const specifier of collectModuleSpecifiers(file.source, file.path)) {
      const target = resolveInternalModule({ consumer: file.path, specifier, modulePaths })
      if (target) {
        targets.add(target)
      } else if (isUnresolvedSourceSpecifier(specifier)) {
        unresolvedInternalEdges.push({ consumer: file.path, specifier })
      }
    }
    graph.set(file.path, targets)
  }

  const normalizedEntrypoints = entrypoints.map(normalizeModulePath)
  const missingEntrypoints = sorted(normalizedEntrypoints.filter((entrypoint) => !modulePaths.has(entrypoint)))
  const reachable = new Set<string>()
  const queue = normalizedEntrypoints.filter((entrypoint) => modulePaths.has(entrypoint))
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || reachable.has(current)) continue
    reachable.add(current)
    for (const target of graph.get(current) ?? []) {
      if (!reachable.has(target)) queue.push(target)
    }
  }

  const normalizedExemptions = new Map(
    Object.entries(exemptions).map(([modulePath, reason]) => [normalizeModulePath(modulePath), reason]),
  )
  const exempt = new Set<string>()
  const staleExemptions = new Set<string>()
  for (const modulePath of normalizedExemptions.keys()) {
    if (modulePaths.has(modulePath)) exempt.add(modulePath)
    else staleExemptions.add(modulePath)
  }

  const candidateUnreachable = new Set(
    [...modulePaths].filter((modulePath) => !reachable.has(modulePath) && !exempt.has(modulePath)),
  )
  const testOnlyTargets = new Set<string>()
  for (const file of normalizedTestFiles) {
    for (const specifier of collectModuleSpecifiers(file.source, file.path)) {
      const target = resolveInternalModule({ consumer: file.path, specifier, modulePaths })
      if (target && candidateUnreachable.has(target)) testOnlyTargets.add(target)
    }
  }

  unresolvedInternalEdges.sort((left, right) => (
    left.consumer.localeCompare(right.consumer)
    || left.specifier.localeCompare(right.specifier)
  ))

  return {
    reachable: sorted(reachable),
    exempt: sorted(exempt),
    candidateUnreachable: sorted(candidateUnreachable),
    testOnlyTargets: sorted(testOnlyTargets),
    unresolvedInternalEdges,
    missingEntrypoints,
    staleExemptions: sorted(staleExemptions),
  }
}
