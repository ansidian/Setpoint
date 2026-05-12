import { publicAssetUrl } from "@/publicAsset";

export function ShellBrand({ isMobile }) {
  return isMobile ? (
    <img
      src={publicAssetUrl("ea-dashboard-mark-v3.svg")}
      alt="EA Dashboard"
      style={{ height: 20, width: 20, flexShrink: 0 }}
    />
  ) : (
    <img
      src={publicAssetUrl("ea-dashboard-header-logo-compact-v3.svg")}
      alt="EA Dashboard"
      style={{ height: 24, flexShrink: 0 }}
    />
  );
}
