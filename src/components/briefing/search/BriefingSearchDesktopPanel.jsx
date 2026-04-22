import { createPortal } from "react-dom";
import { AnimatePresence, motion as Motion } from "motion/react";
import { cn } from "@/lib/utils";
import useBrowserBackDismiss from "@/hooks/useBrowserBackDismiss";
import { DollarSign } from "lucide-react";
import EmailReader from "../../email/EmailReader";

const searchPanelLayoutTransition = {
  type: "spring",
  stiffness: 295,
  damping: 32,
  mass: 0.96,
  bounce: 0,
};

const searchPanelFadeTransition = {
  duration: 0.2,
  ease: [0.16, 1, 0.3, 1],
};

export default function BriefingSearchDesktopPanel({
  panelRef,
  pos,
  openEmail,
  setOpenEmail,
  showBillForm,
  setShowBillForm,
  onMarkedRead,
  onMarkedUnread,
  children,
}) {
  const dismissOpenEmail = useBrowserBackDismiss({
    enabled: !!openEmail,
    historyKey: "eaBriefingSearchEmail",
    onDismiss: () => setOpenEmail(null),
  });

  if (!pos) return null;

  const RESULTS_COLLAPSED_WIDTH = 380;
  const EMAIL_PANE_WIDTH = 720;
  const VIEWPORT_MARGIN = 16;
  const baseWidth = pos.width;
  const resultsWidth = openEmail
    ? Math.min(baseWidth, RESULTS_COLLAPSED_WIDTH)
    : baseWidth;
  const expandedWidth = openEmail
    ? Math.min(
      Math.max(baseWidth, resultsWidth + EMAIL_PANE_WIDTH),
      window.innerWidth - VIEWPORT_MARGIN * 2,
    )
    : baseWidth;
  const maxLeft = window.innerWidth - expandedWidth - VIEWPORT_MARGIN;
  const finalLeft = Math.max(
    VIEWPORT_MARGIN,
    Math.min(pos.left, maxLeft),
  );
  const expandedHeight = openEmail
    ? `calc(100vh - ${pos.top + VIEWPORT_MARGIN}px)`
    : undefined;
  const expandedMaxHeight = openEmail
    ? undefined
    : `min(480px, calc(100vh - ${pos.top + VIEWPORT_MARGIN}px))`;

  return createPortal(
    <Motion.div
      ref={panelRef}
      className="z-[9999] isolate flex flex-row"
      layout
      initial={{ opacity: 0, y: -12, scale: 0.992 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        layout: searchPanelLayoutTransition,
        opacity: searchPanelFadeTransition,
        y: searchPanelFadeTransition,
        scale: searchPanelFadeTransition,
      }}
      style={{
        position: "fixed",
        top: pos.top,
        left: finalLeft,
        width: expandedWidth,
        height: expandedHeight,
        maxHeight: expandedMaxHeight,
        background: "linear-gradient(180deg, #24243a 0%, #1e1e2e 100%)",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow:
          "0 8px 40px rgba(0,0,0,0.55), 0 2px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)",
        overflow: "hidden",
      }}
    >
      <Motion.div
        className="flex flex-col min-h-0 shrink-0"
        layout
        transition={searchPanelLayoutTransition}
        style={{
          width: resultsWidth,
        }}
      >
        {children}
      </Motion.div>

      <AnimatePresence initial={false}>
        {openEmail && (
          <Motion.div
            key={openEmail.uid || openEmail.subject || "search-email"}
            className="relative flex flex-col min-h-0 flex-1"
            initial={{ opacity: 0, x: 20, scale: 0.996 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 14, scale: 0.998 }}
            transition={{
              opacity: searchPanelFadeTransition,
              x: searchPanelFadeTransition,
              scale: searchPanelFadeTransition,
            }}
            style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}
          >
            <EmailReader
              email={openEmail}
              onMarkedRead={onMarkedRead}
              onMarkedUnread={onMarkedUnread}
              onClose={dismissOpenEmail}
              showManualBillForm={showBillForm}
              headerActions={
                <button
                  type="button"
                  onClick={() => setShowBillForm((value) => !value)}
                  className={cn(
                    "flex items-center gap-1 text-[10px] transition-colors px-2 py-1 cursor-pointer font-[inherit]",
                    showBillForm
                      ? "text-[#a6e3a1] bg-[#a6e3a1]/[0.08] hover:bg-[#a6e3a1]/[0.12]"
                      : "text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.04]",
                  )}
                  style={{ borderRadius: 8 }}
                  aria-label={showBillForm ? "Hide bill form" : "Add bill"}
                  title={showBillForm ? "Hide bill form" : "Add bill"}
                >
                  <DollarSign size={11} />
                  <span className="hidden md:inline">{showBillForm ? "Hide bill" : "Add bill"}</span>
                </button>
              }
            />
          </Motion.div>
        )}
      </AnimatePresence>
    </Motion.div>,
    document.body,
  );
}
