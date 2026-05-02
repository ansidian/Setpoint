import { trashEmail } from "../../api";

export function TrashAction({ email, state, setState, onDismiss }) {
  if (!email) return null;
  if (state === "trashing") {
    return <span className="text-[10px] text-muted-foreground/30">Moving to trash…</span>;
  }
  if (state === "confirm") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground/40">Move to trash?</span>
        <button
          onClick={async () => {
            setState("trashing");
            try {
              await trashEmail(email.uid || email.id);
              onDismiss?.(email.id || email.uid);
            } catch {
              setState("idle");
            }
          }}
          className="text-[10px] font-semibold rounded-md px-2.5 py-1 cursor-pointer font-[inherit] transition-all duration-150 hover:brightness-125"
          style={{ color: "#f38ba8", background: "rgba(243,139,168,0.1)", border: "1px solid rgba(243,139,168,0.2)" }}
        >
          Trash
        </button>
        <button
          onClick={() => setState("idle")}
          className="text-[10px] text-muted-foreground/40 bg-transparent border-none cursor-pointer p-0 font-[inherit] transition-colors duration-150 hover:text-muted-foreground/60"
        >
          Cancel
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={() => setState("confirm")}
      className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground/50 bg-transparent border border-white/[0.06] rounded-md px-2.5 py-1 cursor-pointer transition-colors duration-150 hover:text-[#f38ba8] hover:border-[#f38ba8]/30"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      </svg>
      Trash
    </button>
  );
}
