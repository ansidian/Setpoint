export function createSchedulerWorkRegistry() {
  const tracked = new Set();
  const singleFlights = new Map();

  function run(key, task, { singleFlight = false } = {}) {
    if (singleFlight && singleFlights.has(key)) {
      return singleFlights.get(key);
    }

    let promise;
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

  async function drain() {
    while (tracked.size > 0) {
      await Promise.allSettled([...tracked]);
    }
  }

  return { run, drain };
}
