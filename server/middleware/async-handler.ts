// P1-12: Express 4 does NOT catch rejections from async route handlers. Without
// forwarding, a rejected handler produces no HTTP response and the request hangs
// until the socket times out (worst case: the CSRF-exempt /login, which leaves
// the user stuck on a spinner). These helpers forward async rejections to the
// terminal errorHandler so a transient DB/crypto failure returns a clean 500
// instead of hanging.

export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

const ROUTER_METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "all"] as const;
type RouterMethod = (path: unknown, ...handlers: unknown[]) => unknown;

// Wrap a router's verb methods so EVERY function argument (inline middleware as
// well as the final handler) is asyncHandler-wrapped automatically — a rejecting
// async middleware hangs the request just like a rejecting handler does. Scoped
// to the GIVEN router instance only — deliberately NOT a global Express
// monkey-patch (that would silently change ~70 handlers at once); call it
// explicitly per router. Already-guarded fns (own try/catch) and sync fns are
// wrapped too but never reject, so the wrap is a harmless no-op for them.
// NOTE: this does NOT patch router.use(), so middleware registered via
// router.use (e.g. a shared auth guard) must still guard itself — see
// requireCookieSession in ./auth.ts.
export function wrapRouterAsync(router: Router): Router {
  const mutableRouter = router as unknown as Record<(typeof ROUTER_METHODS)[number], RouterMethod>;
  for (const method of ROUTER_METHODS) {
    const original = mutableRouter[method].bind(router);
    mutableRouter[method] = (path, ...handlers) => {
      if (!handlers.length) return original(path);
      const wrapped = handlers.map((handler) =>
        typeof handler === "function" ? asyncHandler(handler as RequestHandler) : handler,
      );
      return original(path, ...wrapped);
    };
  }
  return router;
}

// Terminal Express error middleware (4-arg signature). Mount AFTER all routes.
// Honors err.status (so intentional 4xx from guarded handlers are preserved)
// and the res.headersSent guard (so streaming/SSE routes that already wrote
// headers are not double-responded).
export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  if (res.headersSent) return next(err);
  const errorRecord = typeof err === "object" && err !== null
    ? err as { status?: unknown; message?: unknown }
    : {};
  const status = Number.isInteger(errorRecord.status) ? Number(errorRecord.status) : 500;
  if (status >= 500) {
    console.error("[EA] Unhandled route error:", err);
  }
  res.status(status).json({
    message: status >= 500 ? "Internal server error" : String(errorRecord.message || "Error"),
  });
};
import type {
  ErrorRequestHandler,
  RequestHandler,
  Router,
} from "express";
