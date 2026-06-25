import { describe, expect, it } from "vitest";

// Guard against the return of Scope-B-retired design tokens.
//
// Commit ded7fb8 retired --color-surface / --color-surface-hover / --color-elevated
// from the @theme block (and shadow-modal was never defined post-migration). Tailwind
// utilities like `bg-elevated` / `bg-surface-hover` then compile to NO css rule, so the
// surface renders transparent. This silently broke SearchableDropdown (transparent
// dropdown), command.tsx (invisible active-row highlight), button.tsx (no hover fill),
// and LoadingSkeleton (transparent card).
//
// A CSS-only "dead token" audit misses these because the consumers live inside Tailwind
// className STRINGS in jsx/tsx, not as css var() references. So we guard the strings.
const sources = import.meta.glob("/src/**/*.{jsx,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

// Matches a retired token only as a complete utility class (prefix-token), so live
// arbitrary values like `bg-[var(--sp-surface)]` and the `--sp-surface` var itself are
// NOT flagged — only bare `bg-surface`, `bg-surface-hover`, `bg-elevated`, `shadow-modal`, etc.
const RETIRED_TOKEN =
  /(?<![\w-])(?:bg|text|border|ring|fill|stroke|shadow)-(?:surface-hover|surface|elevated|modal)(?![\w-])/;

describe("retired Scope-B design tokens", () => {
  it("are not referenced in any className across src/", () => {
    const offenders = [];
    for (const [path, raw] of Object.entries(sources)) {
      if (path.includes(".test.")) continue;
      const match = raw.match(RETIRED_TOKEN);
      if (match) offenders.push(`${path} → "${match[0]}"`);
    }
    expect(offenders).toEqual([]);
  });
});
