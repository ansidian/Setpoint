export function makeCalendarBillsData(liveData) {
  return {
    schedules: liveData.allSchedules || [],
    recentTransactions: liveData.recentTransactions || [],
    payeeMap: liveData.payeeMap || {},
    actualBudgetUrl: liveData.actualBudgetUrl,
  };
}
