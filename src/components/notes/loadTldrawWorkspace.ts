import { getTldrawBootstrap } from "../../api";
import type { TldrawBootstrapResponse } from "../../../shared/types/tldraw";
import {
  resolveTldrawRecovery,
  type TldrawRecoveryResolution,
} from "./tldrawRecoveryModel";
import {
  tldrawRecoveryStore,
  type TldrawRecoveryStore,
} from "./tldrawRecoveryStore";

export type LoadedTldrawWorkspace = {
  response: TldrawBootstrapResponse;
  recovery: TldrawRecoveryResolution;
};

export async function loadTldrawWorkspace({
  getBootstrap = getTldrawBootstrap,
  recoveryStore = tldrawRecoveryStore,
}: {
  getBootstrap?: () => Promise<TldrawBootstrapResponse>;
  recoveryStore?: Pick<TldrawRecoveryStore, "read" | "clearIfCurrent">;
} = {}): Promise<LoadedTldrawWorkspace> {
  const [response, localDraft] = await Promise.all([
    getBootstrap(),
    recoveryStore.read(),
  ]);
  const recovery = resolveTldrawRecovery(response.document, localDraft);
  if (recovery.kind === "server" && recovery.staleDraftId) {
    void recoveryStore.clearIfCurrent(recovery.staleDraftId).catch(() => {});
  }
  return { response, recovery };
}
