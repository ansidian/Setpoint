import { useNavigate } from "react-router";
import { RefreshCw } from "lucide-react";
import AnimatedHeight from "../../shared/AnimatedHeight";
import { useDashboardFinance } from "./useDashboardFinance";
import MoneyAheadCard from "./MoneyAheadCard";
import SpendingSnapshotCard from "./SpendingSnapshotCard";
import FinancialActivityCard from "./FinancialActivityCard";
import type { NeedsYouBill } from "../needsYou/needsYouModel";
import type { BillsMirrorHealth } from "../../../../shared/types/bills";

export default function DashboardFinance({ bills, billsLoading, configured, health, refreshing, onOpenBill, onOpenTransactions }: {
  bills: NeedsYouBill[];
  billsLoading: boolean;
  configured: boolean;
  health: BillsMirrorHealth | null;
  refreshing: boolean;
  onOpenBill: (bill: NeedsYouBill, anchor: HTMLElement) => void;
  onOpenTransactions: (date: string) => void;
}) {
  const finance = useDashboardFinance(refreshing);
  const navigate = useNavigate();
  const openReview = (runId?: string) => navigate(`/settings?tab=finance${runId ? `&importRun=${encodeURIComponent(runId)}` : "&reviewPending=1"}#transaction-import-review`);
  return <div className="dashboard-finance">
    <div className="dashboard-finance-grid">
      <MoneyAheadCard bills={bills} loading={billsLoading} configured={configured} health={health} onOpen={onOpenBill} />
      <AnimatedHeight><SpendingSnapshotCard spending={finance.data?.spending} loading={finance.loading} onOpen={onOpenTransactions} /></AnimatedHeight>
    </div>
    <AnimatedHeight><FinancialActivityCard activity={finance.data?.activity} loading={finance.loading} onOpenReview={openReview} /></AnimatedHeight>
    <div className="dashboard-finance-status">
      <span role={finance.error ? "status" : undefined}>{finance.error ? "Couldn’t refresh financial data. Showing the last available information." : finance.loading ? "Refreshing financial context…" : "Financial context from Actual and email imports"}</span>
      <button type="button" className="dashboard-finance-button" disabled={finance.loading} onClick={finance.retry}><RefreshCw size={12} />Refresh</button>
    </div>
  </div>;
}
