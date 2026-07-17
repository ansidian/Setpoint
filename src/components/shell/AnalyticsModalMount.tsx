import { lazy, Suspense } from "react";
import { loadAiAnalyticsModal } from "./aiAnalyticsModalLoader";

const AiAnalyticsModal = lazy(loadAiAnalyticsModal);

export function AnalyticsModalMount({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <Suspense fallback={null}>
      <AiAnalyticsModal open={open} onClose={onClose} />
    </Suspense>
  );
}
