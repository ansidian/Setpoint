import { planTopicSection, summarizeTopicSourceHealth } from "./newsPageModel";
import NewsItemRow from "./NewsItemRow";
import type { NewsTopic } from "../../../shared/types/news.ts";

// One full-width topic band: a sentence-case heading, one lead-story lane,
// compact headlines, and the seen divider between fresh and older items.
// Seen items remain capped by planTopicSection so one noisy feed cannot turn
// the page into an archive. New view suppresses that context and renders a
// quiet caught-up state when a topic has no fresh stories.
interface NewsTopicSectionProps {
  topic: NewsTopic;
  dividerMarker: string | null;
  hideSeen: boolean;
  onOpenManage?: (topicId: number) => void;
}

export default function NewsTopicSection({ topic, dividerMarker, hideSeen, onOpenManage }: NewsTopicSectionProps) {
  const { hasItems, quiet, nothingNew, freshCount, lead, freshRest, visibleOlder, showDivider } =
    planTopicSection(topic.items, dividerMarker, { hideSeen });
  const sourceHealth = summarizeTopicSourceHealth(topic.sources);
  const headingId = `news-topic-${topic.id}-heading`;
  const hasMoreHeadlines = freshRest.length > 0 || visibleOlder.length > 0;

  return (
    <section
      id={`news-topic-${topic.id}`}
      className="news-topic-band"
      aria-labelledby={headingId}
      data-news-topic-id={topic.id}
      data-quiet={quiet ? "true" : "false"}
    >
      <div className="news-topic-header">
        <h3 id={headingId} className="news-topic-heading">{topic.name}</h3>
        {freshCount > 0 ? (
          <span className="news-topic-new-count">{freshCount} new</span>
        ) : null}
        {sourceHealth ? (
          <button
            type="button"
            className={`news-topic-health news-topic-health--${sourceHealth.tone}`}
            aria-label={`${sourceHealth.label}. Open sources for ${topic.name}`}
            onClick={() => onOpenManage?.(topic.id)}
          >
            {sourceHealth.label}
          </button>
        ) : null}
        <span className="news-topic-rule" aria-hidden="true" />
      </div>
      {!hasItems ? (
        <div className="news-topic-empty">No stories yet</div>
      ) : nothingNew ? (
        <div className="news-topic-empty news-topic-caught-up">Caught up</div>
      ) : (
        <div className="news-topic-content">
          <div className="news-topic-lead" role="group" aria-label={`Lead story for ${topic.name}`}>
            <NewsItemRow item={lead!} variant="lead" />
          </div>
          {hasMoreHeadlines ? (
            <div className="news-topic-headlines" role="group" aria-label={`More headlines from ${topic.name}`}>
              {freshRest.map((item) => (
                <NewsItemRow key={item.id} item={item} />
              ))}
              {showDivider ? (
                <div className="news-seen-divider">
                  <span aria-hidden="true" />
                  seen
                  <span aria-hidden="true" />
                </div>
              ) : null}
              {visibleOlder.map((item) => (
                <NewsItemRow key={item.id} item={item} />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
