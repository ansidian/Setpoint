import Section from "../layout/Section";
import { urgencyStyles, formatRelativeDate } from "../../lib/dashboard-helpers";

export default function OtherDeadlinesSection({
  deadlines, ctm, emailAccounts,
  setExpandedTask, setActiveAccount, setSelectedEmail,
  ctmSectionRef, loaded, delay,
}) {
  if (!deadlines?.length) return null;

  return (
    <Section title="Other Deadlines" delay={delay} loaded={loaded} variant="band">
      <div className="flex flex-col gap-1.5">
        {deadlines.map((dl, i) => {
          const dateStr = dl.due_date || dl.due;
          const s = urgencyStyles[dl.urgency] || urgencyStyles.low;
          const ctmMatch =
            (dl.source === "canvas" || dl.type === "academic") && !dl.email_id
              ? (ctm?.upcoming || []).find(
                  (t) => dl.title.includes(t.title) || t.title.includes(dl.title),
                )
              : null;
          const isClickable = !!(dl.email_id || ctmMatch);
          const handleDeadlineClick = () => {
            if (ctmMatch) {
              setExpandedTask(ctmMatch.id);
              ctmSectionRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
              return;
            }
            if (!dl.email_id) return;
            const accIdx = emailAccounts.findIndex((acc) =>
              acc.important?.some((e) => e.id === dl.email_id),
            );
            if (accIdx === -1) return;
            const email = emailAccounts[accIdx].important.find(
              (e) => e.id === dl.email_id,
            );
            if (!email) return;
            setActiveAccount(accIdx);
            setSelectedEmail(email);
          };
          return (
            <div
              key={i}
              role={isClickable ? "button" : undefined}
              tabIndex={isClickable ? 0 : undefined}
              onClick={handleDeadlineClick}
              className="flex items-center gap-3 py-3 px-4 rounded transition-all duration-150"
              style={{
                background: s.bg,
                border: `1px solid ${s.border}22`,
                cursor: isClickable ? "pointer" : "default",
              }}
              onMouseEnter={(e) => {
                if (isClickable)
                  e.currentTarget.style.background = s.bg
                    .replace("0.1", "0.18")
                    .replace("0.08", "0.14");
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = s.bg;
              }}
            >
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: s.dot }}
              />
              <div className="flex-1">
                <div className="text-[14px] font-medium text-text-body">
                  {dl.title}
                </div>
                <div className="text-[11px] text-text-muted">
                  {dl.source}
                </div>
              </div>
              <div className="text-[12px] font-semibold" style={{ color: s.text }}>
                {formatRelativeDate(dateStr)}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
