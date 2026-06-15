import { lazy, Suspense } from "react";
import { loadAiAnalyticsModal } from "./aiAnalyticsModalLoader.js";

const AiAnalyticsModal = lazy(loadAiAnalyticsModal);

export function AnalyticsModalMount({ open, onClose, backdropSnapshot }) {
  if (!open) return null;

  return (
    <Suspense fallback={null}>
      <AiAnalyticsModal
        open={open}
        onClose={onClose}
        backdropSnapshot={backdropSnapshot}
      />
    </Suspense>
  );
}
