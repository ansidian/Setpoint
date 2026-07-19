import { describe, expect, it } from "vitest"
import { guardedFetch } from "../vitest-guardrails.ts"

describe("Vitest guardrails", () => {
  it("rejects external network access before reaching Node fetch", async () => {
    await expect(guardedFetch("https://provider.example.test/data"))
      .rejects.toThrow("Unexpected network request in Vitest")
  })
})
