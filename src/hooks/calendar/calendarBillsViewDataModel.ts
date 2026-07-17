export interface CalendarBillsData {
  schedules?: unknown[];
  allSchedules?: unknown[];
  payLinksByScheduleId?: Record<string, string>;
  isLoading?: boolean;
  pendingUpdate?: boolean;
  [key: string]: unknown;
}

export interface CalendarBillsRangeData {
  data?: CalendarBillsData | null;
  loading?: boolean;
  error?: unknown;
  ensureRange?: (...args: unknown[]) => unknown;
  revision?: number;
}

export interface CalendarBillsViewData extends CalendarBillsData {
  allSchedules: unknown[];
  payLinksByScheduleId: Record<string, string> | undefined;
  isLoading: boolean | undefined;
  pendingUpdate: boolean;
  rangeError: unknown;
  ensureRange: CalendarBillsRangeData["ensureRange"];
  revision: number | undefined;
}

export function computeCalendarBillsViewData({ billsData, billsRangeData }: {
  billsData?: CalendarBillsData;
  billsRangeData?: CalendarBillsRangeData;
} = {}): CalendarBillsViewData {
  const rangeData = billsRangeData?.data;
  const activeBillsData = rangeData || billsData;
  const visibleBillsCount = (
    activeBillsData?.schedules || activeBillsData?.allSchedules || []
  ).length;
  const broadSchedules = billsData?.schedules
    || billsData?.allSchedules
    || activeBillsData?.schedules
    || [];

  return {
    ...activeBillsData,
    allSchedules: broadSchedules,
    payLinksByScheduleId: billsData?.payLinksByScheduleId,
    isLoading: !!billsRangeData?.loading || billsData?.isLoading,
    pendingUpdate: !!visibleBillsCount && (
      !!billsRangeData?.loading
      || !!billsData?.pendingUpdate
      || !!rangeData?.pendingUpdate
    ),
    rangeError: billsRangeData?.error || null,
    ensureRange: billsRangeData?.ensureRange,
    revision: billsRangeData?.revision,
  };
}
