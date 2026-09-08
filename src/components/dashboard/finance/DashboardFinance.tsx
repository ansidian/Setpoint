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
  onOpenTransactions: () => void;
}) {
  const finance = useDashboardFinance(refreshing);
  return <div className="dashboard-finance">
    <AnimatedHeight><FinancialActivityCard review={finance.review} completed={finance.completed} loading={finance.loading} reviewError={finance.reviewError} completedError={finance.completedError} /></AnimatedHeight>
    <div className="dashboard-finance-grid">
      <MoneyAheadCard bills={bills} loading={billsLoading} configured={configured} health={health} onOpen={onOpenBill} />
      <AnimatedHeight><SpendingSnapshotCard spending={finance.data?.spending} loading={finance.loading} onOpen={onOpenTransactions} /></AnimatedHeight>
    </div>
    <div className="dashboard-finance-status">
      <span role={finance.error ? "status" : undefined}>{finance.error ? "Couldn’t refresh the financial summary. Showing the last available information." : finance.loading ? "Refreshing finance…" : "Financial context from Actual and email imports"}</span>
      <button type="button" className="dashboard-finance-button" aria-label="Refresh finance" disabled={finance.loading} onClick={finance.retry}><RefreshCw size={12} />Refresh</button>
    </div>
  </div>;
}
