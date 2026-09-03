import type { EmailAiUsageStats } from "../../../../shared/types/ai-usage";
import EmailAiUsageSection from "./EmailAiUsageSection";

export default function TriageAnalyticsSection({ stats }: { stats: EmailAiUsageStats }) {
  return <EmailAiUsageSection stats={stats} category="triage" />;
}
