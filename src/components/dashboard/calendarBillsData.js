export function makeCalendarBillsData(liveData) {
  return {
    schedules: (liveData.allSchedules || []).map((schedule) => ({ ...schedule, paid: false })),
    recentTransactions: [],
    payeeMap: liveData.payeeMap || {},
    actualBudgetUrl: liveData.actualBudgetUrl,
  };
}
