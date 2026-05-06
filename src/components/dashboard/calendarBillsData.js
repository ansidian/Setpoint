export function makeCalendarBillsData(liveData) {
  return {
    schedules: (liveData.allSchedules || []).map((schedule) => ({ ...schedule })),
    recentTransactions: [],
    payeeMap: liveData.payeeMap || {},
    actualBudgetUrl: liveData.actualBudgetUrl,
    syncHealth: liveData.billsSyncHealth || null,
  };
}
