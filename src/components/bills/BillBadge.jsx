import useBillBadgeForm from "./useBillBadgeForm";
import BillBadgeForm from "./bill-badge/BillBadgeForm";

export default function BillBadge({
  bill,
  model,
  emailSubject,
  emailFrom,
  emailBody,
  emailBodyLoading,
  emailBodySource,
  emailBodyError,
  mapping,
  mappingLoading = false,
  layout = "inline",
}) {
  const isDrawer = layout === "drawer";
  const isMobile = layout === "mobile";
  const usesStackedLayout = isDrawer || isMobile;

  const form = useBillBadgeForm({
    bill,
    model,
    emailSubject,
    emailFrom,
    emailBody,
    emailBodyLoading,
    emailBodySource,
    emailBodyError,
  });

  return (
    <div
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.stopPropagation();
      }}
      className={usesStackedLayout ? "px-0 py-0" : "rounded-xl px-4 py-3"}
      style={usesStackedLayout ? undefined : {
        background: "color-mix(in srgb, var(--sp-accent) 4%, transparent)",
        border: "1px solid color-mix(in srgb, var(--sp-accent) 10%, transparent)",
      }}
    >
      <BillBadgeForm
        bill={bill}
        mapping={mapping}
        mappingLoading={mappingLoading}
        isMobile={isMobile}
        usesStackedLayout={usesStackedLayout}
        {...form}
      />
    </div>
  );
}
