import type { EmailAiUsageStats } from "../../../../shared/types/ai-usage";
import EmailAiUsageSection from "./EmailAiUsageSection";

export default function FinancialEmailAnalyticsSection({ stats }: { stats: EmailAiUsageStats }) {
  return <EmailAiUsageSection stats={stats} category="financialEmail" />;
}
