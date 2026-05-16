import { publicAssetUrl } from "@/publicAsset";

export function ShellBrand({ isMobile }) {
  return isMobile ? (
    <img
      src={publicAssetUrl("setpoint-256.png")}
      alt="Setpoint"
      style={{ height: 20, width: 20, flexShrink: 0 }}
    />
  ) : (
    <img
      src={publicAssetUrl("setpoint.svg")}
      alt="Setpoint"
      style={{ height: 24, flexShrink: 0 }}
    />
  );
}
