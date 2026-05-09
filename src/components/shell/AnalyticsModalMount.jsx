import { lazy, Suspense } from "react";
import { loadTriageAnalyticsModal } from "./triageAnalyticsModalLoader.js";

const TriageAnalyticsModal = lazy(loadTriageAnalyticsModal);

export function AnalyticsModalMount({ open, onClose, backdropSnapshot }) {
  if (!open) return null;

  return (
    <Suspense fallback={null}>
      <TriageAnalyticsModal
        open={open}
        onClose={onClose}
        backdropSnapshot={backdropSnapshot}
      />
    </Suspense>
  );
}
