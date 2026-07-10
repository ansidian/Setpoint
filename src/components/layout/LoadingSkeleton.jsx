import { Skeleton } from "@/components/ui/skeleton";

const timelineRows = [0, 1, 2, 3, 4, 5];
const priorityCards = [0, 1, 2, 3];
const contextCards = [112, 156, 132];

function TimelineSkeletonRow({ index }) {
  return (
    <div
      data-testid="skeleton-timeline-row"
      className="loading-skeleton-timeline-row"
      style={{ animationDelay: `${160 + index * 45}ms` }}
    >
      <Skeleton className="h-3 w-[42px] bg-white/8" />
      <div className="flex min-w-0 flex-col gap-[7px]">
        <Skeleton className="h-3 w-[58%] bg-white/10" />
        <Skeleton className="h-2.5 w-[42%] bg-white/7" />
      </div>
      <Skeleton className="loading-skeleton-row-badge h-[18px] w-14 bg-white/8" />
    </div>
  );
}

export default function LoadingSkeleton() {
  return (
    <div className="loading-skeleton-frame min-h-screen w-full text-text-body font-sans">
      <style>{`
        @keyframes loadingSkeletonFadeIn { to { opacity: 1; } }
        .loading-skeleton-frame {
          box-sizing: border-box;
          max-width: 1480px;
          margin: 0 auto;
          padding: 15px 18px 18px;
        }
        .loading-skeleton-stage {
          opacity: 0;
          animation: loadingSkeletonFadeIn 0.4s ease forwards;
        }
        .loading-skeleton-band {
          display: flex;
          gap: 14px;
          min-height: 142px;
          padding: 16px;
          overflow: hidden;
        }
        .loading-skeleton-priorities {
          display: flex;
          flex: 1;
          gap: 10px;
          min-width: 0;
          overflow: hidden;
        }
        .loading-skeleton-priority { flex: 0 0 220px; }
        .loading-skeleton-lower {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 344px;
          gap: 14px;
          margin-top: 14px;
        }
        .loading-skeleton-timeline-row {
          display: grid;
          grid-template-columns: 54px 1fr auto;
          gap: 14px;
          align-items: center;
          padding: 9px 12px;
          min-height: 58px;
          opacity: 0;
          animation: loadingSkeletonFadeIn 0.4s ease forwards;
        }
        @media (max-width: 639px) {
          .loading-skeleton-frame { max-width: 640px; padding: 0 16px 32px; }
          .loading-skeleton-band { flex-direction: column; min-height: 0; }
          .loading-skeleton-priorities { overflow: hidden; }
          .loading-skeleton-priority { flex-basis: min(78vw, 280px); }
          .loading-skeleton-lower { display: flex; flex-direction: column; margin-top: 14px; }
          .loading-skeleton-timeline-row { grid-template-columns: 52px minmax(0, 1fr); gap: 10px; padding: 10px; }
          .loading-skeleton-row-badge { display: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .loading-skeleton-stage, .loading-skeleton-timeline-row { animation-duration: 0.01ms; }
        }
      `}</style>

      <section
        data-testid="skeleton-band"
        className="loading-skeleton-stage loading-skeleton-band rounded-2xl border border-white/[0.05] bg-white/[0.018]"
        style={{ animationDelay: "80ms" }}
      >
        <div className="flex w-[150px] shrink-0 flex-col justify-center gap-3">
          <Skeleton className="h-9 w-16 bg-white/10" />
          <Skeleton className="h-3 w-24 bg-white/7" />
        </div>
        <div className="loading-skeleton-priorities">
          {priorityCards.map((index) => (
            <Skeleton key={index} className="loading-skeleton-priority rounded-xl bg-white/[0.055]" />
          ))}
        </div>
      </section>

      <div className="loading-skeleton-lower">
        <section
          data-testid="skeleton-timeline"
          className="loading-skeleton-stage rounded-2xl border border-white/[0.05] bg-white/[0.018] p-4"
          style={{ animationDelay: "140ms" }}
        >
          <Skeleton className="mb-5 h-4 w-36 bg-white/10" />
          {timelineRows.map((index) => <TimelineSkeletonRow key={index} index={index} />)}
        </section>

        <aside
          data-testid="skeleton-context"
          className="loading-skeleton-stage flex flex-col gap-[14px]"
          style={{ animationDelay: "240ms" }}
        >
          {contextCards.map((height, index) => (
            <Skeleton
              key={height}
              className="w-full rounded-2xl border border-white/[0.05] bg-white/[0.025]"
              style={{ height, animationDelay: `${260 + index * 70}ms` }}
            />
          ))}
        </aside>
      </div>
    </div>
  );
}
