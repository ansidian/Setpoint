export function buildContainerStyle({ isMobile, pos, host, active, keyboardOffset }) {
  const base = {
    position: "fixed",
    background: "#16161e",
    border: "1px solid rgba(255,255,255,0.06)",
    padding: 0,
    zIndex: 9999,
    isolation: "isolate",
    overscrollBehavior: "contain",
    fontFamily: "inherit",
    opacity: active ? 1 : 0,
    transition: "opacity 180ms ease, transform 220ms cubic-bezier(0.16, 1, 0.3, 1)",
  };

  if (isMobile) {
    return {
      ...base,
      left: 0,
      right: 0,
      bottom: keyboardOffset,
      width: "100%",
      maxHeight: "calc(88vh - env(safe-area-inset-bottom))",
      overflowY: "auto",
      borderRadius: "16px 16px 0 0",
      borderBottom: "none",
      boxShadow: "0 -18px 48px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.04)",
      paddingBottom: "env(safe-area-inset-bottom)",
      transform: active ? "translateY(0)" : "translateY(100%)",
      transformOrigin: "bottom center",
    };
  }

  if (host === "modal") {
    return {
      ...base,
      top: "50%",
      left: "50%",
      width: 560,
      maxWidth: "92vw",
      maxHeight: "85vh",
      overflowY: "auto",
      borderRadius: 16,
      boxShadow: "0 40px 100px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.06)",
      transform: active ? "translate(-50%, -50%) scale(1)" : "translate(-50%, -48%) scale(0.96)",
      transformOrigin: "center center",
      transition: "opacity 200ms ease, transform 240ms cubic-bezier(0.16, 1, 0.3, 1)",
    };
  }

  return {
    ...base,
    top: pos.top,
    left: pos.left,
    width: pos.width,
    maxHeight: "calc(100vh - 24px)",
    overflowY: "auto",
    borderRadius: 12,
    boxShadow: "0 30px 80px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.04)",
    transform: active ? "translateY(0)" : "translateY(-6px)",
    transformOrigin: "top left",
  };
}

export function buildInlineContainerStyle() {
  return {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minHeight: "100%",
    background: "transparent",
    border: "none",
    boxShadow: "none",
    overflowY: "auto",
    fontFamily: "inherit",
    opacity: 1,
    transition: "none",
    transform: "none",
  };
}

export const DRAG_HANDLE_STYLE = {
  width: 36,
  height: 4,
  borderRadius: 9999,
  background: "rgba(205,214,244,0.18)",
  margin: "8px auto 0",
};

export function buildDropdownRowStyle(isMobile) {
  return {
    display: "flex",
    flexDirection: isMobile ? "column" : "row",
    gap: 8,
    marginBottom: 8,
  };
}
