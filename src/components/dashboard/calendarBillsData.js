export function makeCalendarBillsData(liveData, { pendingUpdate = false } = {}) {
  return {
    schedules: (liveData.allSchedules || []).map((schedule) => ({ ...schedule })),
    transactions: [],
    payeeMap: liveData.payeeMap || {},
    actualBudgetUrl: liveData.actualBudgetUrl,
    syncHealth: liveData.billsSyncHealth || null,
    pendingUpdate: !!pendingUpdate,
  };
}
