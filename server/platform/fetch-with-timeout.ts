/**
 * fetchWithTimeout(url, options, { timeoutMs, fetchFn })
 *
 * Creates an AbortController, arms a timeout, and calls fetchFn with the signal.
 * Rejects if options.signal is already set (no preset signals allowed).
 * Clears the timer in a finally block.
 */
type FetchInput = string | URL | Request;

export type FetchFunction<T> = (
  input: FetchInput,
  init?: RequestInit,
) => Promise<T>;

type FetchTimeoutOptions<T> = {
  timeoutMs?: number;
  fetchFn?: FetchFunction<T>;
};

export function fetchWithTimeout<T = Response>(
  url: FetchInput,
  options: RequestInit = {},
  { timeoutMs = 15_000, fetchFn = fetch as FetchFunction<T> }: FetchTimeoutOptions<T> = {},
): Promise<T> {
  if (options.signal) {
    throw new TypeError("options.signal must not be set; use the timeoutMs parameter instead");
  }

  const controller = new AbortController();
  const fetchPromise = fetchFn(url, { ...options, signal: controller.signal });

  const timeoutId = setTimeout(() => {
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
export function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}
