import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const componentSizeBaseline = {
  threshold: 600,
  files: {
    'src/components/calendar/CalendarRailStates.jsx': 995,
    'src/components/calendar/ScheduleSection.jsx': 807,
    'src/components/calendar/events/CalendarEventEditorRail.jsx': 782,
    'src/components/calendar/views/deadlines/DeadlinesDetailRail.jsx': 711,
    'src/components/calendar/views/events/EventsWorkspaceSupport.jsx': 857,
    'src/components/dashboard/rails/Rails.jsx': 988,
    'src/components/email/EmailSection.jsx': 641,
    'src/components/shell/ShellHeaderChrome.jsx': 656,
    'src/pages/Dashboard.jsx': 1009,
  },
}

const failures = []
const warnings = []

async function exists(relativePath) {
  try {
    await fs.stat(path.join(root, relativePath))
    return true
  } catch {
    return false
  }
}

async function readText(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8')
}

async function collectFiles(dir, predicate) {
  const absoluteDir = path.join(root, dir)
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const relativePath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue
      files.push(...await collectFiles(relativePath, predicate))
      continue
    }

    if (predicate(relativePath)) {
      files.push(relativePath)
    }
  }

  return files
}

async function checkIgnoredKnowledge() {
  const gitignore = await readText('.gitignore')
  const lines = gitignore
    .split(/\r?\n/)
    .map((line) => line.trim())

  if (lines.includes('AGENTS.md')) {
    failures.push('AGENTS.md should be tracked as the agent entry point')
  }

  if (!lines.includes('docs/')) {
    failures.push('docs/ should remain gitignored for this personal single-user repo')
  }
}

async function checkAgentsMap() {
  const agents = await readText('AGENTS.md')
  const lines = agents.trimEnd().split(/\r?\n/)
  if (lines.length > 120) {
    failures.push(`AGENTS.md is ${lines.length} lines; keep it near 100 lines and move details into docs/`)
  }

  for (const pointer of ['ARCHITECTURE.md', 'PRODUCT.md', 'DESIGN.md', 'gitignored for this personal single-user repo', 'npm run check:harness']) {
    if (!agents.includes(pointer)) {
      failures.push(`AGENTS.md should point to ${pointer}`)
    }
  }
}

async function checkHistoricalDocsCleanup() {
  if (await exists('docs/superpowers')) {
    failures.push('docs/superpowers still exists; historical plans/specs should live under docs/exec-plans or docs/design-docs/history')
  }

  const generated = await readText('docs/generated/full-system-deep-dive-2026-04-12.md').catch(() => '')
  if (generated && !generated.includes('Generated')) {
    warnings.push('Generated deep dive does not identify itself as generated context')
  }
}

async function checkComponentSizes() {
  const baseline = componentSizeBaseline
  const threshold = baseline.threshold
  const componentFiles = await collectFiles('src', (relativePath) => {
    if (!/\.(jsx|tsx)$/.test(relativePath)) return false
    if (/\.test\.(jsx|tsx)$/.test(relativePath)) return false
    return relativePath.includes('/components/') || relativePath.includes('/pages/')
  })

  const oversized = []
  for (const file of componentFiles) {
    const text = await readText(file)
    const lineCount = text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0)
    if (lineCount <= threshold) continue
    oversized.push([file, lineCount])

    const allowed = baseline.files[file]
    if (!allowed) {
      failures.push(`${file} is ${lineCount} lines and is not in the component-size baseline`)
    } else if (lineCount > allowed) {
      failures.push(`${file} grew from baseline ${allowed} lines to ${lineCount}; decompose or update the baseline with justification`)
    }
  }

  const currentFiles = new Set(oversized.map(([file]) => file))
  for (const file of Object.keys(baseline.files)) {
    if (!currentFiles.has(file)) {
      warnings.push(`${file} is in the component-size baseline but no longer exceeds ${threshold} lines; remove it from the baseline`)
    }
  }

  if (oversized.length > 0) {
    const summary = oversized
      .sort((a, b) => b[1] - a[1])
      .map(([file, count]) => `  - ${file}: ${count}`)
      .join('\n')
    warnings.push(`Oversized component debt above ${threshold} lines:\n${summary}`)
  }
}

await checkIgnoredKnowledge()
await checkAgentsMap()
await checkHistoricalDocsCleanup()
await checkComponentSizes()

for (const warning of warnings) {
  console.warn(`Warning: ${warning}`)
}

if (failures.length > 0) {
  console.error('Agent harness check failed:')
  for (const failure of failures) {
    console.error(`  - ${failure}`)
  }
  process.exit(1)
}

console.log('Agent harness check passed.')
