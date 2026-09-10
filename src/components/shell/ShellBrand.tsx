import { publicAssetUrl } from "@/publicAsset";

export function ShellBrand() {
  return (
    <img
      src={publicAssetUrl("setpoint.svg")}
      alt="Setpoint"
      style={{ height: 24, width: "auto", flexShrink: 0 }}
    />
  );
}
