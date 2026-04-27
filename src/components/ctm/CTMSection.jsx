import Section from "../layout/Section";
import CTMCard from "./CTMCard";

export default function CTMSection({ ctm, expandedTask, setExpandedTask, ctmSectionRef, loaded, delay }) {
  if (!ctm?.upcoming?.length) return null;

  return (
    <div ref={ctmSectionRef}>
      <Section title="Assignments & Deadlines" delay={delay} loaded={loaded} variant="band">
        <div className="border-b border-white/[0.05] pb-3 mb-3">
          <div className="flex gap-4 items-baseline flex-wrap">
            <div>
              <span className="text-[24px] font-semibold text-foreground">
                {ctm.stats.incomplete}
              </span>
              <span className="text-[12px] text-text-muted ml-1.5">
                incomplete
              </span>
            </div>
            <div>
              <span className="text-[24px] font-semibold text-red-300">
                {ctm.stats.dueToday}
              </span>
              <span className="text-[12px] text-text-muted ml-1.5">
                due today
              </span>
            </div>
            <div>
              <span className="text-[24px] font-semibold text-yellow-300">
                {ctm.stats.dueThisWeek}
              </span>
              <span className="text-[12px] text-text-muted ml-1.5">
                this week
              </span>
            </div>
            <div className="ml-auto">
              <a
                href="https://ctm.andysu.tech"
                target="_blank"
                rel="noopener noreferrer"
                role="button"
                tabIndex={0}
                className="bg-purple-400/[0.08] border border-purple-400/[0.15] rounded-md py-1 px-2 text-[11px] font-medium cursor-pointer text-purple-400 flex items-center gap-1 no-underline transition-all duration-200 hover:bg-purple-400/[0.18] hover:border-purple-400/[0.35] hover:-translate-y-px"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
                </svg>
                CTM
              </a>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          {ctm.upcoming.map((task) => (
            <CTMCard
              key={task.id}
              task={task}
              expanded={expandedTask === task.id}
              onToggle={() =>
                setExpandedTask(expandedTask === task.id ? null : task.id)
              }
            />
          ))}
        </div>
      </Section>
    </div>
  );
}
