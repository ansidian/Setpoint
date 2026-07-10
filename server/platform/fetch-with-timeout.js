/**
 * fetchWithTimeout(url, options, { timeoutMs, fetchFn })
 *
 * Creates an AbortController, arms a timeout, and calls fetchFn with the signal.
 * Rejects if options.signal is already set (no preset signals allowed).
 * Clears the timer in a finally block.
 */
export function fetchWithTimeout(
  url,
  options = {},
  { timeoutMs = 15_000, fetchFn = fetch } = {}
) {
  if (options.signal) {
    throw new TypeError("options.signal must not be set; use the timeoutMs parameter instead");
  }

  const controller = new AbortController();
  let timeoutId;

  const fetchPromise = fetchFn(url, { ...options, signal: controller.signal });

  timeoutId = setTimeout(() => {
    controller.abort(new Error(`fetch timeout after ${timeoutMs}ms: ${url}`));
  }, timeoutMs);

  return fetchPromise.finally(() => {
    clearTimeout(timeoutId);
  });
}

/**
 * withTimeout(promise, timeoutMs, label)
 *
 * Races a promise against a timeout rejection.
 * Clears the timeout timer when the promise settles (in either direction).
 */
export function withTimeout(promise, timeoutMs, label) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}
