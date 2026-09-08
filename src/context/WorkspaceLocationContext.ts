import { createContext, useContext } from 'react';
import { useLocation } from 'react-router';
import type { Location } from 'react-router';
export const WorkspaceLocationContext = createContext<Location|null>(null);
export function useWorkspaceLocation():Location {
  const location = useLocation();
  return useContext(WorkspaceLocationContext) || location;
}
