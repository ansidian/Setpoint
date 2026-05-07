import { Tooltip as ShadTooltip, TooltipContent } from "@/components/ui/tooltip";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

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
}) {
  if (!text) return children;

  return (
    <ShadTooltip delay={delay} disableHoverablePopup={disableHoverablePopup}>
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
