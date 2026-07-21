import { describe, expect, test } from "vitest"
import { findForbiddenSourcePatterns } from "./design-policy.mts"

describe("findForbiddenSourcePatterns", () => {
  const rules = [
    {
      name: "retired design utility",
      pattern: /(?<![\w-])bg-(?:surface|elevated)(?![\w-])/,
    },
    {
      name: "frozen accent literal",
      pattern: /#cba6da/i,
    },
  ]

  test("reports every offender with an actionable file path, rule, and literal", () => {
    expect(findForbiddenSourcePatterns({
      files: [
        { path: "src/components/BadSurface.tsx", source: 'className="bg-elevated"' },
        { path: "src/components/FrozenAccent.tsx", source: 'color: "#CBA6DA"' },
      ],
      rules,
    })).toEqual([
      'src/components/BadSurface.tsx uses retired design utility "bg-elevated"',
      'src/components/FrozenAccent.tsx uses frozen accent literal "#CBA6DA"',
    ])
  })

  test("accepts a clean source set and does not confuse live token references with retired utilities", () => {
    expect(findForbiddenSourcePatterns({
      files: [
        {
          path: "src/components/GoodSurface.tsx",
          source: 'className="bg-[var(--sp-surface)]" style={{ color: "var(--ea-accent)" }}',
        },
      ],
      rules,
    })).toEqual([])
  })
})
