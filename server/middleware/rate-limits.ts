import rateLimit from "express-rate-limit";

// Per-IP spend guards for LLM- and paid-API-backed routes (REL-08). These
// routes are already session-gated, so this bounds runaway-client / stolen
// -session spend rather than acting as the primary access control. Mirrors
// the construction style of the auth.js limiters (standardHeaders: true,
// legacyHeaders: false, JSON message).
//
// Each limiter is exported two ways:
//   - a `makeXLimiter()` factory that builds a fresh, independently-stateful
//     instance (used by tests that need isolation, since express-rate-limit
//     tracks counts per-instance and singletons imported once by a test file
//     would otherwise leak counts across test cases);
//   - a singleton built from that factory (used by the real route wiring).

export function makeBillExtractLimiter() {
  return rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 20,
    message: { message: "Too many bill-extract requests, try again later" },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

export function makeAlfredRunLimiter() {
  return rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 30,
    message: { message: "Too many Alfred run requests, try again later" },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

export function makeEmailSearchLimiter() {
  return rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 120,
    message: { message: "Too many email search requests, try again later" },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

export function makePlacesLimiter() {
  return rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 120,
    message: { message: "Too many places requests, try again later" },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

export function makeActualConnectionLimiter() {
  return rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    message: { message: "Too many Actual connection requests, try again later" },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

export const billExtractLimiter = makeBillExtractLimiter();
export const alfredRunLimiter = makeAlfredRunLimiter();
export const emailSearchLimiter = makeEmailSearchLimiter();
export const placesLimiter = makePlacesLimiter();
export const actualConnectionLimiter = makeActualConnectionLimiter();
