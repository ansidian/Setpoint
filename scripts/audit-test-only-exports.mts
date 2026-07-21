import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

interface ExportUsage {
  file: string;
  name: string;
  runtime: boolean;
  productionReferences: Set<string>;
  testReferences: Set<string>;
  declarationRanges: Array<{ file: string; start: number; end: number }>;
}

const root = process.cwd();
const baselinePath = path.join(root, "scripts/lib/export-reachability-baseline.json");
const configs = ["tsconfig.client.json", "tsconfig.server.json", "tsconfig.tools.json"];
const entrypoints = new Set([
  "src/main.tsx",
  "server/index.ts",
  "server/actual/actual-worker-child.ts",
  "eslint.config.ts",
  "playwright.config.ts",
  "vite.config.ts",
  "vitest.config.ts",
]);

function relative(fileName: string): string {
  return path.relative(root, fileName).split(path.sep).join("/");
}

function isLocalSource(sourceFile: ts.SourceFile): boolean {
  const file = relative(sourceFile.fileName);
  return !file.startsWith("../")
    && !file.startsWith("node_modules/")
    && !sourceFile.isDeclarationFile;
}

function isTestSource(file: string): boolean {
  return file.startsWith("e2e/")
    || /\.(?:test|spec)\.(?:ts|tsx|mts|cts)$/.test(file)
    || file.includes("/test-utils/")
    || /\.test-(?:setup|utils)\.(?:ts|tsx)$/.test(file);
}

function canonicalSymbol(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  let current = symbol;
  const seen = new Set<ts.Symbol>();
  while ((current.flags & ts.SymbolFlags.Alias) !== 0 && !seen.has(current)) {
    seen.add(current);
    current = checker.getAliasedSymbol(current);
  }
  return current;
}

function analyzeConfig(configPath: string): ExportUsage[] {
  const absoluteConfig = path.join(root, configPath);
  const loaded = ts.readConfigFile(absoluteConfig, ts.sys.readFile);
  if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, root);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const checker = program.getTypeChecker();
  const usageBySymbol = new Map<ts.Symbol, ExportUsage>();

  for (const sourceFile of program.getSourceFiles()) {
    if (!isLocalSource(sourceFile)) continue;
    const file = relative(sourceFile.fileName);
    if (isTestSource(file) || entrypoints.has(file)) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;

    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const symbol = canonicalSymbol(checker, exported);
      if (usageBySymbol.has(symbol)) continue;
      const declarations = symbol.getDeclarations() ?? [];
      const localDeclarations = declarations.filter((declaration) => isLocalSource(declaration.getSourceFile()));
      const firstDeclaration = localDeclarations[0];
      if (!firstDeclaration) continue;
      const declarationFile = relative(firstDeclaration.getSourceFile().fileName);
      if (isTestSource(declarationFile) || entrypoints.has(declarationFile)) continue;
      usageBySymbol.set(symbol, {
        file: declarationFile,
        name: exported.getName(),
        runtime: (symbol.flags & ts.SymbolFlags.Value) !== 0,
        productionReferences: new Set(),
        testReferences: new Set(),
        declarationRanges: localDeclarations.map((declaration) => ({
          file: relative(declaration.getSourceFile().fileName),
          start: declaration.getFullStart(),
          end: declaration.getEnd(),
        })),
      });
    }
  }

  for (const sourceFile of program.getSourceFiles()) {
    if (!isLocalSource(sourceFile)) continue;
    const file = relative(sourceFile.fileName);
    const test = isTestSource(file);

    function visit(node: ts.Node): void {
      if (!test) {
        const namespaceModule = ts.isImportDeclaration(node)
          && node.importClause?.namedBindings
          && ts.isNamespaceImport(node.importClause.namedBindings)
          ? checker.getSymbolAtLocation(node.moduleSpecifier)
          : null;
        const dynamicModule = ts.isCallExpression(node)
          && node.expression.kind === ts.SyntaxKind.ImportKeyword
          && node.arguments[0]
          ? checker.getSymbolAtLocation(node.arguments[0])
          : null;
        const moduleSymbol = namespaceModule || dynamicModule;
        if (moduleSymbol) {
          for (const exported of checker.getExportsOfModule(moduleSymbol)) {
            const usage = usageBySymbol.get(canonicalSymbol(checker, exported));
            usage?.productionReferences.add(file);
          }
        }
      }
      if (ts.isIdentifier(node)) {
        const rawSymbol = checker.getSymbolAtLocation(node);
        if (rawSymbol) {
          const symbol = canonicalSymbol(checker, rawSymbol);
          const usage = usageBySymbol.get(symbol);
          if (usage) {
            const insideOwnDeclaration = usage.declarationRanges.some((range) => (
              range.file === file && node.getStart(sourceFile) >= range.start && node.getEnd() <= range.end
            ));
            if (!insideOwnDeclaration) {
              (test ? usage.testReferences : usage.productionReferences).add(file);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return [...usageBySymbol.values()];
}

const merged = new Map<string, ExportUsage>();
for (const config of configs) {
  for (const usage of analyzeConfig(config)) {
    const key = `${usage.file}:${usage.name}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, usage);
      continue;
    }
    usage.productionReferences.forEach((file) => existing.productionReferences.add(file));
    usage.testReferences.forEach((file) => existing.testReferences.add(file));
  }
}

const candidates = [...merged.values()]
  .filter((usage) => usage.productionReferences.size === 0)
  .sort((left, right) => left.file.localeCompare(right.file) || left.name.localeCompare(right.name));

const runtimeCandidates = candidates.filter((usage) => usage.runtime);
const typeCandidates = candidates.filter((usage) => !usage.runtime);
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as {
  exemptions: Record<string, string>;
};
const candidateKeys = new Set(candidates.map((usage) => `${usage.file}:${usage.name}`));
const unexpected = candidates.filter((usage) => !baseline.exemptions[`${usage.file}:${usage.name}`]);
const staleExemptions = Object.keys(baseline.exemptions).filter((key) => !candidateKeys.has(key)).sort();

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({
    runtimeCandidates: runtimeCandidates.map((usage) => ({
      file: usage.file,
      name: usage.name,
      tests: [...usage.testReferences].sort(),
      exemption: baseline.exemptions[`${usage.file}:${usage.name}`] ?? null,
    })),
    typeCandidates: typeCandidates.map((usage) => ({
      file: usage.file,
      name: usage.name,
      tests: [...usage.testReferences].sort(),
    })),
    unexpected: unexpected.map((usage) => `${usage.file}:${usage.name}`),
    staleExemptions,
  }, null, 2));
} else {
  for (const usage of unexpected) {
    const kind = usage.testReferences.size ? "test-only" : "unreferenced";
    console.log(`${kind}: ${usage.file} -> ${usage.name}`);
    for (const test of [...usage.testReferences].sort()) console.log(`  test: ${test}`);
  }
  for (const key of staleExemptions) console.log(`stale exemption: ${key}`);
  console.log(`Export reachability: ${JSON.stringify({
    runtimeCandidates: runtimeCandidates.length,
    typeCandidates: typeCandidates.length,
    exempted: candidates.length - unexpected.length,
    unexpected: unexpected.length,
    staleExemptions: staleExemptions.length,
  })}`);
}

if (unexpected.length > 0 || staleExemptions.length > 0) process.exit(1);
