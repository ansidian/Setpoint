import { createContext, useContext } from "react";

export interface AlfredWorkspace {
  open: boolean;
  close: () => void;
  setDockTarget: (target: HTMLDivElement | null) => void;
}

export const AlfredWorkspaceContext = createContext<AlfredWorkspace | null>(null);
export const useAlfredWorkspace = () => useContext(AlfredWorkspaceContext);
