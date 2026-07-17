function isDraftable(value: unknown): value is object {
  if (value == null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return Array.isArray(value) || prototype === Object.prototype || prototype === null;
}

export function createCopyOnWriteView<T>(source: T): T {
  const views = new WeakMap<object, object>();

  const view = (value: unknown): unknown => {
    if (!isDraftable(value)) return value;
    if (views.has(value)) return views.get(value);

    const overlay = new Map<string | symbol, unknown>();
    const deleted = new Set<string | symbol>();
    const proxy = new Proxy(value, {
      get(target, property) {
        if (deleted.has(property)) return undefined;
        const current = overlay.has(property) ? overlay.get(property) : Reflect.get(target, property);
        return view(current);
      },
      set(_target, property, nextValue) {
        deleted.delete(property);
        overlay.set(property, nextValue);
        return true;
      },
      deleteProperty(_target, property) {
        overlay.delete(property);
        deleted.add(property);
        return true;
      },
      has(target, property) {
        if (deleted.has(property)) return false;
        return overlay.has(property) || Reflect.has(target, property);
      },
      ownKeys(target) {
        const keys = new Set(Reflect.ownKeys(target));
        for (const property of overlay.keys()) keys.add(property);
        for (const property of deleted) keys.delete(property);
        return [...keys];
      },
      getOwnPropertyDescriptor(target, property) {
        if (deleted.has(property)) return undefined;
        if (overlay.has(property)) {
          return { configurable: true, enumerable: true, writable: true, value: view(overlay.get(property)) };
        }
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (!descriptor) return undefined;
        if (property === "length" && Array.isArray(target)) return descriptor;
        return { ...descriptor, configurable: true, value: view(Reflect.get(target, property)) };
      },
    });

    views.set(value, proxy);
    return proxy;
  };

  return view(source) as T;
}
