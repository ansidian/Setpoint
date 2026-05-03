export default function RefreshBanner({ progress }) {
  return (
    <div className="rounded-lg px-5 py-3 mb-5 flex items-center gap-3 animate-[fadeIn_0.3s_ease]" style={{ background: "rgba(203,166,218,0.06)", border: "1px solid rgba(203,166,218,0.15)" }}>
      <div className="w-[18px] h-[18px] border-[1.5px] border-white/[0.06] border-t-primary rounded-full animate-spin shrink-0" />
      <div>
        <div className="text-[13px] font-semibold text-foreground/90">
          Syncing dashboard data...
        </div>
        <div className="text-xs text-muted-foreground/60 mt-0.5 transition-opacity duration-200">
          {progress || "Starting up..."}
        </div>
      </div>
    </div>
  );
}
