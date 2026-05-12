function count(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function getInboxTriageActivity(processing = {}, { loading = false } = {}) {
  const emailRunning = count(processing.email_triage?.running ?? processing.running);
  const historySync = processing.gmail_history_sync || {};
  const historyActive = !!historySync.active
    || count(historySync.running) > 0
    || count(historySync.pending) > 0
    || count(historySync.queued) > 0;

  return {
    processingCount: emailRunning,
    syncing: !!loading || emailRunning > 0 || historyActive,
  };
}
