import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function SkeletonBar({ className }) {
  return <Skeleton className={cn("h-3.5", className)} />;
}

function SkeletonSection({ titleWidth, lines, delay }) {
  return (
    <div
      className="mb-6 opacity-0 animate-[fadeIn_0.4s_ease_forwards]"
      style={{ animationDelay: `${delay}ms` }}
    >
      <Skeleton className={cn("h-[11px] mb-3", titleWidth)} />
      <div className="bg-card border border-border rounded-lg px-5 py-4 flex flex-col gap-3">
        {lines.map((w, i) => (
          <SkeletonBar key={i} className={w} />
        ))}
      </div>
    </div>
  );
}

export default function LoadingSkeleton() {
  return (
    <div className="min-h-screen text-text-body font-sans p-6 max-w-[900px] mx-auto">
      <style>{`
        @keyframes fadeIn { to { opacity: 1; } }
      `}</style>

      {/* Header */}
      <div className="mb-8 flex justify-between items-start">
        <div>
          <Skeleton className="w-[120px] h-[11px] mb-2" />
          <Skeleton className="w-[260px] h-9 mb-1.5" />
          <Skeleton className="w-[200px] h-[13px]" />
        </div>
        <Skeleton className="w-[100px] h-[100px] rounded-lg" />
      </div>

      <SkeletonSection titleWidth="w-[100px]" lines={["w-full", "w-[90%]", "w-[95%]", "w-[80%]", "w-[85%]"]} delay={100} />
      <SkeletonSection titleWidth="w-[160px]" lines={["w-full", "w-full", "w-full"]} delay={200} />
      <SkeletonSection titleWidth="w-[110px]" lines={["w-full", "w-[85%]"]} delay={300} />
      <SkeletonSection titleWidth="w-[140px]" lines={["w-full", "w-full", "w-full", "w-full", "w-full", "w-full"]} delay={400} />
      <SkeletonSection titleWidth="w-[100px]" lines={["w-full", "w-full", "w-full", "w-full"]} delay={500} />
      <SkeletonSection titleWidth="w-[100px]" lines={["w-full", "w-full", "w-full"]} delay={600} />
    </div>
  );
}
