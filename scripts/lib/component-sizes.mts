const SOURCE_RE = /\.(ts|tsx)$/
const TEST_RE = /\.test\.(ts|tsx)$/
const VITEST_RE = /\.test\.(ts|tsx|mts)$/

interface SizedFile {
  path: string
  lineCount: number
}

interface SizeBaseline {
  threshold: number
  files: Record<string, number>
}

interface SizeCheckResult {
  failures: string[]
  warnings: string[]
}

// A source file the size guardrail governs: any non-test .ts/.tsx under src/.
// Deliberately NOT restricted to /components/ or /pages/ — hooks (src/hooks/**) and
// loose controllers/models were the harness blind spot that let a 1519-line hook grow.
export function isSizeCheckedSource(relPath: string): boolean {
  return SOURCE_RE.test(relPath) && !TEST_RE.test(relPath)
}

export function isSizeCheckedTest(relPath: string): boolean {
  return VITEST_RE.test(relPath)
}

// Ratcheting size check. `files` is [{ path, lineCount }]; `baseline` is
// { threshold:number, files: { [path]: allowedLineCount } }. A file over the
// threshold must appear in the baseline and must not exceed its recorded allowance.
export function checkSizeBaseline({
  files,
  baseline,
  baselineName = "component-size",
  debtName = "source-file",
}: {
  files: SizedFile[]
  baseline: SizeBaseline
  baselineName?: string
  debtName?: string
}): SizeCheckResult {
  const failures: string[] = []
  const warnings: string[] = []
  const { threshold } = baseline

  const oversized = files
    .filter((file) => file.lineCount > threshold)
    .sort((a, b) => b.lineCount - a.lineCount)

  for (const { path: file, lineCount } of oversized) {
    const allowed = baseline.files[file]
    if (allowed === undefined) {
      failures.push(`${file} is ${lineCount} lines and is not in the ${baselineName} baseline`)
    } else if (lineCount > allowed) {
      failures.push(
        `${file} grew from baseline ${allowed} lines to ${lineCount}; decompose or update the baseline with justification`,
      )
    }
  }

  const oversizedPaths = new Set(oversized.map((file) => file.path))
  for (const file of Object.keys(baseline.files)) {
    if (!oversizedPaths.has(file)) {
      warnings.push(
        `${file} is in the component-size baseline but no longer exceeds ${threshold} lines; remove it from the baseline`,
      )
    }
  }

  if (oversized.length > 0) {
    const summary = oversized.map(({ path: file, lineCount }) => `  - ${file}: ${lineCount}`).join("\n")
    warnings.push(`Oversized ${debtName} debt above ${threshold} lines:\n${summary}`)
  }

  return { failures, warnings }
}
