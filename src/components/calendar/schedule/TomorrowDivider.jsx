export default function TomorrowDivider() {
  return (
    <div className="relative flex items-center gap-2 py-3 my-1">
      <div
        className="absolute left-[-20px] w-[11px] h-[11px] rounded-full"
        style={{
          border: "2px solid rgba(203,166,218,0.4)",
          background: "#16161e",
        }}
      />
      <span
        className="text-[10px] max-sm:text-xs font-bold tracking-[1.5px] uppercase"
        style={{ color: "rgba(203,166,218,0.5)" }}
      >
        Tomorrow
      </span>
      <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
    </div>
  );
}
