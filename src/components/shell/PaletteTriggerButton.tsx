export function PaletteTriggerButton({ onOpenPalette }: { onOpenPalette: () => void }) {
  const isApple = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const shortcut = isApple ? "⌘K" : "Ctrl K";
  return (
    <button
      type="button"
      className="shell-palette-trigger"
      aria-label="Open command palette"
      title={`Command palette (${shortcut})`}
      aria-keyshortcuts={isApple ? "Meta+K" : "Control+K"}
      onClick={onOpenPalette}
    >
      <span aria-hidden="true">{shortcut}</span>
    </button>
  );
}
