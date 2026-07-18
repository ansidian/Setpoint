import { ListChecks, RotateCw } from "lucide-react";
import type { CapabilityStatus } from "../../../../shared/types/capabilities";
import { Button } from "@/components/ui/button";
import { SettingsCard, StatusPill } from "../settings-ui";
import { SETTINGS_SECONDARY_BUTTON_CLASS } from "../settings-core";
import { CAPABILITY_LABELS, projectCapabilityStatus } from "./capabilityOverviewModel";

export default function CapabilityOverviewCard({
  capabilities,
  onRefresh,
}: {
  capabilities: CapabilityStatus[];
  onRefresh: () => void;
}) {
  return (
    <SettingsCard
      title="Setup overview"
      icon={<ListChecks size={14} />}
      description="One shared view of what is working, optional, pending, or needs attention."
      headerAction={(
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={`${SETTINGS_SECONDARY_BUTTON_CLASS} motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
          onClick={onRefresh}
        >
          <RotateCw size={12} />
          Refresh
        </Button>
      )}
    >
      <div className="divide-y divide-white/[0.05] border-y border-white/[0.06]">
        {capabilities.length === 0 ? (
          <p className="py-3 text-[11px] text-muted-foreground">Capability status is unavailable. Existing integration controls remain usable.</p>
        ) : null}
        {capabilities.map((capability) => {
          const view = projectCapabilityStatus(capability);
          return (
            <div key={capability.id} className="flex min-h-11 items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-foreground">{CAPABILITY_LABELS[capability.id]}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {view.optional ? "Optional enhancement" : `Source: ${capability.source}`}
                </div>
              </div>
              <StatusPill tone={view.tone} className="shrink-0 normal-case tracking-normal">
                {view.label}
              </StatusPill>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span>Setup never opens automatically after you finish it.</span>
        <a
          href="/onboarding"
          className="shrink-0 rounded-md px-2 py-1 font-medium text-primary transition-[background-color,color,transform] duration-200 hover:-translate-y-px hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none"
        >
          Open setup checklist
        </a>
      </div>
    </SettingsCard>
  );
}
