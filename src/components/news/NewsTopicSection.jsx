import { splitItemsBySeen } from "./newsPageModel.js";
import NewsItemRow from "./NewsItemRow.jsx";

const QUIET_ITEM_CAP = 5;
const EXCERPT_ITEM_CAP = 3;

export default function NewsTopicSection({ topic, dividerMarker }) {
  const hasItems = topic.items.length > 0;
  const { fresh, older } = splitItemsBySeen(topic.items, dividerMarker);
  const isQuiet = hasItems && fresh.length === 0;
  const visibleOlder = isQuiet ? older.slice(0, QUIET_ITEM_CAP) : older;
  const showDivider = fresh.length > 0 && visibleOlder.length > 0;

  return (
    <section style={{ marginBottom: 22 }}>
      <h3
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 1.6,
          textTransform: "uppercase",
          color: "var(--sp-subtext)",
          opacity: isQuiet ? 0.6 : 1,
          margin: "0 0 8px",
        }}
      >
        {topic.name}
      </h3>
      {!hasItems ? (
        <div style={{ color: "var(--sp-overlay)", fontSize: 12 }}>No stories yet</div>
      ) : (
        <div>
          {fresh.map((item, index) => (
            <NewsItemRow key={item.id} item={item} showExcerpt={index < EXCERPT_ITEM_CAP} />
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
            <NewsItemRow key={item.id} item={item} showExcerpt={false} />
          ))}
        </div>
      )}
    </section>
  );
}
