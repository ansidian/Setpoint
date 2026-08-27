import { publicAssetUrl } from "@/publicAsset";

export function ShellBrand({ isMobile }: { isMobile: boolean }) {
  return (
    <img
      src={publicAssetUrl("setpoint.svg")}
      alt="Setpoint"
      style={{ height: isMobile ? 18 : 24, width: "auto", flexShrink: 0 }}
    />
  );
}
