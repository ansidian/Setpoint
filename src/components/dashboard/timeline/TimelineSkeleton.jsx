import { Skeleton } from "@/components/ui/skeleton";
import { GUTTER, MOBILE_GUTTER, MOBILE_SPINE_LEFT, SPINE_LEFT } from "./timeline-helpers";

export default function TimelineSkeleton({ isMobile = false }) {
  return (
    <div
      data-testid="dashboard-event-skeletons"
      style={{
        marginBottom: 18,
        paddingLeft: isMobile ? MOBILE_GUTTER : GUTTER,
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: isMobile ? MOBILE_SPINE_LEFT : SPINE_LEFT,
            top: 8,
            bottom: 8,
            width: 1,
            background: "rgba(255,255,255,0.06)",
          }}
        />
        {[0, 1].map((index) => (
          <div
            key={index}
            style={{
              position: "relative",
              display: "grid",
              gridTemplateColumns: isMobile ? "52px minmax(0, 1fr)" : "54px 1fr auto",
              gap: isMobile ? 10 : 14,
              alignItems: "center",
              padding: isMobile ? "10px 10px 10px 22px" : "9px 12px",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: isMobile ? -30 : -22,
                top: isMobile ? 13 : 14,
                width: 13,
                height: 13,
                borderRadius: 99,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "#0b0b13",
              }}
            />
            <Skeleton className="h-[12px] w-[42px] bg-white/8" />
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <Skeleton className="h-[12px] w-[58%] bg-white/10" />
              <Skeleton className="h-[10px] w-[42%] bg-white/7" />
            </div>
            {!isMobile && <Skeleton className="h-[18px] w-[56px] bg-white/8" />}
          </div>
        ))}
      </div>
    </div>
  );
}
