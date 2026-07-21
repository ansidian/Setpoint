import { Mail } from "lucide-react";
import { Kbd } from "../primitives";
import EmptyStateSplash from "../../shared/EmptyStateSplash";

export function ReaderEmptyState() {
  return (
    <div
      style={{
        flex: 1,
        background: "color-mix(in srgb, var(--sp-panel) 50%, transparent)",
        padding: "20px 20px 0",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "flex-start",
      }}
    >
      <div
        data-testid="inbox-reader-empty-state-card"
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
        }}
      >
        <EmptyStateSplash
          icon={<Mail size={34} strokeWidth={1.8} />}
          eyebrow="Inbox reader"
          title="Select an email"
          message={(
            <>
              Open a thread to keep context visible while you work.
              <span
                style={{
                  display: "block",
                  marginTop: 12,
                  fontSize: 11,
                  color: "var(--color-text-faint)",
                }}
              >
                <Kbd>J</Kbd> <Kbd>K</Kbd> to move through the list.
              </span>
            </>
          )}
          compact
          minHeight="100%"
        />
      </div>
    </div>
  );
}
