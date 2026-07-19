export type SourceFile = {
  path: string
  source: string
}

export type ForbiddenSourceRule = {
  name: string
  pattern: RegExp
}

export function findForbiddenSourcePatterns({
  files,
  rules,
}: {
  files: SourceFile[]
  rules: ForbiddenSourceRule[]
}): string[] {
  const failures: string[] = []

  for (const file of files) {
    for (const rule of rules) {
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", ""))
      const match = pattern.exec(file.source)
      if (match) {
        failures.push(`${file.path} uses ${rule.name} "${match[0]}"`)
      }
    }
  }

  return failures
}
