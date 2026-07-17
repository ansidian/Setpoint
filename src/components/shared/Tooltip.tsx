import type { CSSProperties, ReactElement, ReactNode } from "react";
import { Tooltip as ShadTooltip, TooltipContent } from "@/components/ui/tooltip";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

export type TooltipProps = {
  text?: ReactNode;
  children: ReactElement;
  style?: CSSProperties;
  side?: TooltipPrimitive.Positioner.Props["side"];
  sideOffset?: number;
  collisionAvoidance?: TooltipPrimitive.Positioner.Props["collisionAvoidance"];
  delay?: number;
  closeDelay?: number;
  disableHoverablePopup?: boolean;
  contentStyle?: CSSProperties;
  actionsRef?: TooltipPrimitive.Root.Props["actionsRef"];
};

export default function Tooltip({
  text,
  children,
  style,
  side,
  sideOffset,
  collisionAvoidance,
  delay,
  closeDelay,
  disableHoverablePopup,
  contentStyle,
  actionsRef,
}: TooltipProps) {
  if (!text) return children;

  return (
    <ShadTooltip actionsRef={actionsRef} delay={delay} disableHoverablePopup={disableHoverablePopup}>
      <TooltipPrimitive.Trigger
        data-slot="tooltip-trigger"
        closeDelay={closeDelay}
        render={<span className="inline-flex" style={style} />}
      >
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipContent side={side} sideOffset={sideOffset} collisionAvoidance={collisionAvoidance} style={contentStyle}>{text}</TooltipContent>
    </ShadTooltip>
  );
}
