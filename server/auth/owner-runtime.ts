import type { OwnerIdentity } from "./owner-context.ts";

export function createOwnerRuntimeGate(
  start: (owner: OwnerIdentity) => void,
  { enabled = true }: { enabled?: boolean } = {},
) {
  let started = false;

  return {
    startForOwner(owner: OwnerIdentity | null): boolean {
      if (!enabled || !owner || started) return false;
      started = true;
      start(owner);
      return true;
    },
  };
}
