import type { CurrentDashboardLiveData } from "../../hooks/currentDashboardModel";
import type { BillsMirrorHealth } from "../../../shared/types/bills";
import type { ActualBillOccurrence } from "../../../shared/types/actual";

export interface DashboardCalendarBillsData {
  schedules: ActualBillOccurrence[];
  transactions: [];
  payeeMap: Record<string, string>;
  actualBudgetUrl: string | null;
  syncHealth: BillsMirrorHealth | null;
  pendingUpdate: boolean;
}

export function makeCalendarBillsData(
  liveData: CurrentDashboardLiveData,
  { pendingUpdate = false }: { pendingUpdate?: boolean } = {},
): DashboardCalendarBillsData {
  return {
    schedules: (liveData.allSchedules || []).map((schedule) => ({ ...schedule })),
    transactions: [],
    payeeMap: liveData.payeeMap || {},
    actualBudgetUrl: liveData.actualBudgetUrl,
    syncHealth: liveData.billsSyncHealth || null,
    pendingUpdate: !!pendingUpdate,
  };
}
