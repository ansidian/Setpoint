import { AlertTriangle, RotateCw } from "lucide-react";

interface ErrorStateProps {
  message?: string | null;
  onRetry?: () => void;
}

export default function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="min-h-screen text-foreground font-sans flex items-center justify-center">
      <div className="text-center max-w-[400px] p-6">
        <div className="mb-4 flex justify-center text-[#f9e2af]"><AlertTriangle size={40} /></div>
        <h2 className="font-serif text-[24px] font-normal mb-2 text-foreground">
          Something went wrong
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-5">
          {message || "Failed to load your morning briefing."}
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="bg-[#cba6da] text-[#1e1e2e] border-none rounded-default px-5 py-2.5 text-[13px] font-semibold cursor-pointer transition-all hover:bg-[#d4b3e2] hover:-translate-y-px active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            aria-label="Retry loading"
          >
            <RotateCw size={14} strokeWidth={2.5} />
            Try Again
          </button>
        )}
      </div>
    </div>
  );
}
