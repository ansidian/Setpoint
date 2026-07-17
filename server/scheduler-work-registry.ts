export type SchedulerTask<T> = () => T | PromiseLike<T>;

export interface SchedulerRunOptions {
  singleFlight?: boolean;
}

export function createSchedulerWorkRegistry() {
  const tracked = new Set<Promise<unknown>>();
  const singleFlights = new Map<string, Promise<unknown>>();

  function run<T>(
    key: string,
    task: SchedulerTask<T>,
    { singleFlight = false }: SchedulerRunOptions = {},
  ): Promise<T> {
    if (singleFlight && singleFlights.has(key)) {
      return singleFlights.get(key) as Promise<T>;
    }

    let promise: Promise<T>;
    try {
      promise = Promise.resolve(task());
    } catch (err) {
      promise = Promise.reject(err);
    }

    tracked.add(promise);
    if (singleFlight) singleFlights.set(key, promise);

    const cleanup = () => {
      tracked.delete(promise);
      if (singleFlights.get(key) === promise) singleFlights.delete(key);
    };
    promise.then(cleanup, cleanup);
    return promise;
  }

  async function drain(): Promise<void> {
    while (tracked.size > 0) {
      await Promise.allSettled([...tracked]);
    }
  }

  return { run, drain };
}
