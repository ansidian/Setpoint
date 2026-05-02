import { MotionChevron, MotionExpand } from "../ui/motion-wrappers";
import { GhostAction } from "./EmailSectionControls.jsx";

export function EmailSectionNoiseList({
  totalNoiseCount,
  noiseExpanded,
  setNoiseExpanded,
  noiseAccounts,
  multiNoiseAccounts,
  openNoiseInReader,
}) {
  if (totalNoiseCount <= 0) return null;

  return (
    <div className="mt-3">
      <GhostAction
        onClick={() => setNoiseExpanded(!noiseExpanded)}
        className="w-full flex items-center justify-between"
      >
        <span>{totalNoiseCount} email{totalNoiseCount !== 1 ? "s" : ""} filtered as noise</span>
        <MotionChevron isOpen={noiseExpanded} className="text-muted-foreground/25" />
      </GhostAction>
      <MotionExpand isOpen={noiseExpanded}>
        <div
          className="mt-2 border-t border-white/[0.04] pt-3"
        >
          {noiseAccounts.map((acc, i) => (
            <div key={i} className={i > 0 ? "mt-3 pt-3 border-t border-white/[0.04]" : ""}>
              {multiNoiseAccounts && (
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: acc.color, opacity: 0.7 }}
                  />
                  <span className="text-[10px] max-sm:text-xs font-medium text-muted-foreground/40">{acc.name}</span>
                </div>
              )}
              <div className="flex flex-col">
                {acc.noise.map((noiseEmail, j) => {
                  const noiseId = noiseEmail.id || `noise-${i}-${j}`;
                  return (
                    <div
                      key={noiseId}
                      role="button"
                      tabIndex={0}
                      onClick={() => openNoiseInReader(noiseEmail, acc)}
                      className="flex items-center gap-2 min-w-0 py-1.5 px-1 rounded cursor-pointer hover:bg-white/[0.04] transition-colors duration-150"
                    >
                      <span className="text-[11px] max-sm:text-xs text-muted-foreground/35 shrink-0 min-w-[80px] max-w-[140px] truncate">{noiseEmail.from}</span>
                      <span className="text-[11px] max-sm:text-xs text-muted-foreground/55 truncate flex-1">{noiseEmail.subject}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </MotionExpand>
    </div>
  );
}
