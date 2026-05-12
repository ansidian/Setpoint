export function isDemoMode() {
  return import.meta.env.VITE_EA_DEMO === "1";
}

export function createDemoApiError(path) {
  const error = new Error(`Demo mode has no API handler for ${path}.`);
  error.code = "DEMO_API_UNHANDLED";
  error.status = 501;
  return error;
}
