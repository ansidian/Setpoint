import { Sparkles } from "lucide-react";
import type { MouseEventHandler } from "react";
import { cn } from "@/lib/utils";
import type { BillType, FinancialEmailPlan } from "../../../../shared/types/bills";
import type { BillExtractState } from "../useBillBadgeForm";
import { typeHints, typeLabels } from "./helpers";
import { presentFinancialPlan } from "./financialPlanPresentationModel";

interface ExtractButtonProps {
  extractState: BillExtractState;
  onClick: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  className?: string;
  variant?: "pill" | "block";
}

function ExtractButton({ extractState, onClick, disabled = false, className, variant = "pill" }: ExtractButtonProps) {
  const isBlock = variant === "block";
  const isDisabled = disabled || extractState === "extracting";
  const label = extractState === "extracting"
    ? "Extracting…"
    : extractState === "error"
      ? "Retry extract"
      : "Extract bill";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={cn(
        "group cursor-pointer inline-flex items-center justify-center gap-1.5",
        "font-bold tracking-wider uppercase rounded-md",
        "transition-all duration-200 ease-out motion-reduce:transition-none motion-reduce:!animate-none",
        "hover:-translate-y-px active:translate-y-0 active:scale-[0.98] motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#16161e]",
        "disabled:cursor-wait disabled:hover:translate-y-0",
        disabled && "disabled:cursor-not-allowed opacity-55",
        isBlock ? "text-[11px] px-4 py-2 w-full" : "text-[10px] px-2.5 py-1 shrink-0",
        className,
      )}
      style={
        extractState === "error"
          ? {
            color: "var(--sp-rose)",
            background: "color-mix(in srgb, var(--sp-rose) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--sp-rose) 30%, transparent)",
          }
          : {
            color: "#ffffff",
            background:
                "linear-gradient(120deg, #c88fa0 0%, #c89b85 25%, #8fb8c8 55%, #a89bc4 80%, #c88fa0 100%)",
            backgroundSize: "240% 100%",
            animation: extractState === "extracting" ? "aiGradientShift 2.5s ease-in-out infinite" : "none",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow:
                  extractState === "extracting"
                    ? "0 0 10px rgba(168,155,196,0.35), 0 0 18px rgba(143,184,200,0.15)"
                    : "0 1px 6px rgba(168,155,196,0.2)",
            textShadow: "0 1px 2px rgba(0,0,0,0.45)",
          }
      }
      onMouseEnter={(event) => {
        if (isDisabled || extractState === "error") return;
        event.currentTarget.style.boxShadow =
          "0 2px 12px rgba(168,155,196,0.4), 0 0 20px rgba(143,184,200,0.2)";
        event.currentTarget.style.animationDuration = "4s";
      }}
      onMouseLeave={(event) => {
        if (isDisabled || extractState === "error") return;
        event.currentTarget.style.boxShadow = "0 1px 6px rgba(168,155,196,0.2)";
        event.currentTarget.style.animationDuration = "7s";
      }}
    >
      <span
        className={cn(
          "inline-flex transition-transform duration-300 motion-reduce:transition-none",
          extractState !== "extracting" && "group-hover:rotate-12 group-hover:scale-110 motion-reduce:group-hover:rotate-0 motion-reduce:group-hover:scale-100",
        )}
      >
        <Sparkles size={isBlock ? 13 : 11} strokeWidth={2} />
      </span>
      <span>{label}</span>
    </button>
  );
}

interface BillBadgeHeaderProps {
  isMobile: boolean;
  usesStackedLayout: boolean;
  plan?: FinancialEmailPlan | null;
  planLoading: boolean;
  editType: BillType;
  effectiveModel: string | null;
  modelDisplayName: string;
  showExtract: boolean;
  extractDisabled: boolean;
  extractState: BillExtractState;
  onExtract: MouseEventHandler<HTMLButtonElement>;
  onTypeChange: (type: BillType) => void;
}

export default function BillBadgeHeader({
  isMobile,
  usesStackedLayout,
  plan,
  planLoading,
  editType,
  effectiveModel,
  modelDisplayName,
  showExtract,
  extractDisabled,
  extractState,
  onExtract,
  onTypeChange,
}: BillBadgeHeaderProps) {
  const planPresentation = presentFinancialPlan(plan, planLoading);
  return (
    <>
      <div className={cn("flex items-center gap-1.5 flex-wrap", isMobile && "grid grid-cols-2 gap-2")}>
        {(Object.keys(typeLabels) as BillType[]).map((key) => {
          const info = typeLabels[key];
          const Icon = info.Icon;
          const selected = editType === key;
          return (
            <button
              type="button"
              key={key}
              onClick={(event) => {
                event.stopPropagation();
                onTypeChange(key);
              }}
              className={cn(
                "inline-flex items-center gap-1 font-semibold tracking-wide rounded-md cursor-pointer transition-all duration-200 motion-reduce:transition-none",
                "hover:-translate-y-px active:translate-y-0 active:scale-[0.98] motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#16161e]",
                isMobile ? "w-full justify-center text-[10.5px] px-3 py-2" : "text-[10px] px-2 py-1",
              )}
              style={{
                color: selected ? info.color : "var(--color-text-faint)",
                background: selected ? `${info.color}14` : "rgba(255,255,255,0.02)",
                border: `1px solid ${selected ? `${info.color}38` : "rgba(255,255,255,0.04)"}`,
              }}
            >
              <Icon size={11} strokeWidth={2} />
              <span>{info.label}</span>
            </button>
          );
        })}
        {!usesStackedLayout && (
          <span className="text-[10px] text-muted-foreground/75 italic ml-1 truncate">
            {typeHints[editType]}
          </span>
        )}
        {!usesStackedLayout && effectiveModel ? (
          <span className="text-[10px] text-muted-foreground/75 ml-auto shrink-0">
            detected by {modelDisplayName}
          </span>
        ) : !usesStackedLayout && showExtract ? (
          <ExtractButton
            extractState={extractState}
            disabled={extractDisabled}
            onClick={onExtract}
            className="ml-auto"
          />
        ) : null}
      </div>
      {usesStackedLayout && (
        <div className={cn("text-muted-foreground/75 italic", isMobile ? "text-[11px] mt-3" : "text-[10px] mt-1.5")}>
          {typeHints[editType]}
        </div>
      )}
      {planPresentation && (
        <div
          role={planPresentation.tone === "review" ? "status" : undefined}
          className={cn(
            "mt-3 rounded-lg border px-3 py-2 min-w-0",
            planPresentation.tone === "ready" && "border-[color-mix(in_srgb,var(--sp-green)_24%,transparent)] bg-[color-mix(in_srgb,var(--sp-green)_7%,transparent)]",
            planPresentation.tone === "review" && "border-[color-mix(in_srgb,var(--sp-yellow)_24%,transparent)] bg-[color-mix(in_srgb,var(--sp-yellow)_7%,transparent)]",
            planPresentation.tone === "no_write" && "border-white/[0.07] bg-white/[0.025]",
            planPresentation.tone === "loading" && "border-[color-mix(in_srgb,var(--sp-blue)_20%,transparent)] bg-[color-mix(in_srgb,var(--sp-blue)_6%,transparent)]",
          )}
        >
          <div className="text-[12px] font-semibold text-foreground break-words">{planPresentation.title}</div>
          <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground break-words">
            {planPresentation.detail}
          </div>
        </div>
      )}
      {usesStackedLayout && (
        effectiveModel ? (
          <div className={cn("text-muted-foreground/75 text-right", isMobile ? "text-[11px] mt-2.5" : "text-[10px] mt-2")}>
            detected by {modelDisplayName}
          </div>
        ) : showExtract ? (
          <div className={cn(isMobile ? "mt-3.5" : "mt-3")}>
            <ExtractButton
              extractState={extractState}
              disabled={extractDisabled}
              onClick={onExtract}
              className="w-full justify-center"
              variant="block"
            />
          </div>
        ) : null
      )}
    </>
  );
}
