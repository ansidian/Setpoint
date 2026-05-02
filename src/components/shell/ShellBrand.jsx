export function ShellBrand({ isMobile }) {
  return isMobile ? (
    <img
      src="/ea-dashboard-mark-v3.svg"
      alt="EA Dashboard"
      style={{ height: 20, width: 20, flexShrink: 0 }}
    />
  ) : (
    <img
      src="/ea-dashboard-header-logo-compact-v3.svg"
      alt="EA Dashboard"
      style={{ height: 24, flexShrink: 0 }}
    />
  );
}
