import { splitItemsBySeen } from "./newsPageModel.js";
import NewsItemRow from "./NewsItemRow.jsx";

const QUIET_ITEM_CAP = 5;
const OLDER_ITEM_CAP = 8;

// One topic section: label header with a fresh-count pill, a lead story
// (newest fresh item, or the newest item at all when the topic is quiet),
// compact headlines, and the seen divider between fresh and older items.
// Seen items are context, not content — they cap at OLDER_ITEM_CAP so one
// noisy feed can't turn its column into a 30-row archive.
export default function NewsTopicSection({ topic, dividerMarker }) {
  const hasItems = topic.items.length > 0;
  const { fresh, older } = splitItemsBySeen(topic.items, dividerMarker);
  const isQuiet = hasItems && fresh.length === 0;
  const lead = fresh[0] ?? older[0] ?? null;
  const freshRest = fresh.slice(1);
  const visibleOlder = isQuiet ? older.slice(1, QUIET_ITEM_CAP) : older.slice(0, OLDER_ITEM_CAP);
  const showDivider = fresh.length > 0 && visibleOlder.length > 0;

  return (
    <section style={{ breakInside: "avoid", marginBottom: 30 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          margin: "0 0 10px",
          opacity: isQuiet ? 0.62 : 1,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            color: "var(--sp-subtext)",
            whiteSpace: "nowrap",
          }}
        >
          {topic.name}
        </h3>
        {fresh.length > 0 ? (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "var(--sp-accent)",
              background: "color-mix(in srgb, var(--sp-accent) 12%, transparent)",
              borderRadius: 999,
              padding: "1px 7px",
              whiteSpace: "nowrap",
            }}
          >
            {fresh.length} new
          </span>
        ) : null}
        <span aria-hidden style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
      </header>
      {!hasItems ? (
        <div style={{ color: "var(--sp-overlay)", fontSize: 12 }}>No stories yet</div>
      ) : (
        <div>
          <NewsItemRow item={lead} variant="lead" />
          {freshRest.map((item) => (
            <NewsItemRow key={item.id} item={item} />
          ))}
          {showDivider ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                margin: "6px 0",
                color: "var(--sp-overlay)",
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: 1.2,
              }}
            >
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
              seen
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
            </div>
          ) : null}
          {visibleOlder.map((item) => (
            <NewsItemRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
