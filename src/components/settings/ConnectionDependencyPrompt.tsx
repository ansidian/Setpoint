import { AlertTriangle, PlugZap } from "lucide-react";
import type { ConnectionId } from "./connectionModel";

const ACTION_CLASS =
  "inline-flex min-h-8 items-center rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-[12px] font-medium text-foreground no-underline transition-[background-color,border-color,color,transform] duration-200 hover:-translate-y-px hover:border-primary/25 hover:bg-primary/[0.08] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none";

export interface ConnectionDependencyAction {
  connectionId: ConnectionId;
  label: string;
}

export default function ConnectionDependencyPrompt({
  title,
  description,
  actions,
  attention = false,
}: {
  title: string;
  description: string;
  actions: readonly ConnectionDependencyAction[];
  attention?: boolean;
}) {
  const Icon = attention ? AlertTriangle : PlugZap;

  return (
    <section
      data-settings-section=""
      className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-4 sm:px-5"
    >
      <div className="flex items-start gap-3">
        <div className={attention
          ? "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning"
          : "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"}
        >
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
          <p className="mt-1 max-w-[70ch] text-[12px] leading-relaxed text-muted-foreground/80">
            {description}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {actions.map((action) => (
              <a
                key={action.connectionId}
                href={`/settings?tab=connections#${action.connectionId}`}
                className={ACTION_CLASS}
              >
                {action.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
