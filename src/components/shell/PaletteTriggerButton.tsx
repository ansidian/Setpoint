export function PaletteTriggerButton({ onOpenPalette }: { onOpenPalette: () => void }) {
  return (
    <button
      type="button"
      className="shell-palette-trigger"
      aria-label="Open command palette"
      title="Command palette (⌘K)"
      onClick={onOpenPalette}
    >
      <span aria-hidden="true">⌘K</span>
    </button>
  );
}
