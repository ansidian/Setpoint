export function computeCalendarBillsViewData({ billsData, billsRangeData } = {}) {
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
