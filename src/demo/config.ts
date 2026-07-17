export interface DemoApiError extends Error {
  code: "DEMO_API_UNHANDLED";
  status: 501;
}

export function isDemoMode(): boolean {
  return import.meta.env.VITE_EA_DEMO === "1";
}

export function createDemoApiError(path: string): DemoApiError {
  const error = new Error(`Demo mode has no API handler for ${path}.`) as DemoApiError;
  error.code = "DEMO_API_UNHANDLED";
  error.status = 501;
  return error;
}
