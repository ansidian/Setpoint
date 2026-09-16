import { useImperativeHandle, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { createHeightMotionBudget, heightMotionEase } from "@/lib/motion";

export interface ExpandingTextareaProps extends ComponentProps<"textarea"> {
  expandable?: boolean;
}

/** Ordinary notes stay open while focused or populated; long-form editors can opt out. */
export default function ExpandingTextarea({
  expandable = true,
  value,
  defaultValue,
  rows,
  className,
  style,
  ref,
  onChange,
  onFocus,
  onBlur,
  onPointerDown,
  ...props
}: ExpandingTextareaProps) {
  const [focused, setFocused] = useState(false);
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? "");
  const content = String(value ?? uncontrolledValue);
  const expanded = focused || !!content.trim();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previousHeight = useRef<number | undefined>(undefined);
  const animation = useRef<Animation | null>(null);
  const motionBudget = useRef(createHeightMotionBudget());
  useImperativeHandle(ref, () => textareaRef.current!, []);
  const minHeight = typeof style?.minHeight === "string"
    ? style.minHeight
    : Math.max(expanded ? 72 : 38, style?.minHeight ?? 0);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    // Remember the rendered height before an input changes intrinsic sizing.
    // Native dragging and width changes update this baseline without animating.
    const observer = new ResizeObserver(() => {
      if (!animation.current) previousHeight.current = textarea.offsetHeight;
    });
    // Panel edge handlers must not cancel a wheel gesture owned by the notes.
    const onWheel = (event: WheelEvent) => {
      const overflow = getComputedStyle(textarea).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && textarea.scrollHeight > textarea.clientHeight) event.stopPropagation();
    };
    observer.observe(textarea);
    textarea.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      observer.disconnect();
      textarea.removeEventListener("wheel", onWheel);
      animation.current?.cancel();
    };
  }, []);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const from = animation.current ? textarea.offsetHeight : previousHeight.current;
    animation.current?.cancel();
    animation.current = null;
    if (!expandable) return;
    if (!content.trim() && style?.height === undefined) textarea.style.removeProperty("height");
    const to = textarea.offsetHeight;
    previousHeight.current = to;
    if (from === undefined || from === to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const duration = motionBudget.current(performance.now()) * 1000;
    if (!duration) return;
    // Animate the field itself so its border and the surrounding layout move
    // together. Once finished, intrinsic sizing owns the height again.
    const next = textarea.animate([
      { height: `${from}px`, minHeight: `${from}px` },
      { height: `${to}px`, minHeight: `${to}px` },
    ], { duration, easing: `cubic-bezier(${heightMotionEase.join(",")})` });
    animation.current = next;
    next.onfinish = () => { animation.current = null; };
  }, [content, expandable, minHeight, style?.height]);

  return (
    <textarea
      {...props}
      ref={textareaRef}
      value={value}
      defaultValue={defaultValue}
      rows={expandable ? 1 : rows}
      data-expanding={expandable ? "true" : undefined}
      className={cn("sp-expanding-textarea", className)}
      style={{
        ...style,
        ...(expandable ? { minHeight } : {}),
      }}
      onChange={(event) => {
        if (value === undefined) setUncontrolledValue(event.target.value);
        onChange?.(event);
      }}
      onPointerDown={(event) => {
        animation.current?.cancel();
        animation.current = null;
        previousHeight.current = event.currentTarget.offsetHeight;
        onPointerDown?.(event);
      }}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
    />
  );
}
