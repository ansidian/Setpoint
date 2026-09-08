export type FinanceDestination =
  | { view:'utilities'; utilityId?:string; month?:string; statementId?:string }
  | { view:'schedule'; scheduleId:string; date?:string }
  | { view:'journal'; date?:string; transactionId?:string };
export function financesHref(target:FinanceDestination = { view:'utilities' }):string {
  const query = new URLSearchParams();
  if (target.view === 'journal') { query.set('view','journal'); if (target.date) query.set('date',target.date); if (target.transactionId) query.set('transaction',target.transactionId); }
  else if (target.view === 'schedule') { query.set('schedule',target.scheduleId); if (target.date) query.set('date',target.date); }
  else { if (target.utilityId) query.set('utility',target.utilityId); if (target.month) query.set('month',target.month); if (target.statementId) query.set('statement',target.statementId); }
  return `/finances${query.size ? `?${query}` : ''}`;
}
export function financeDestination(search:string):FinanceDestination {
  const query = new URLSearchParams(search);
  const rawDate = query.get('date') || '';
  const validDate = (value:string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  const date = validDate(rawDate) ? rawDate : undefined;
  if (query.get('view') === 'journal') return { view:'journal', date, transactionId:query.get('transaction') || undefined };
  if (query.get('schedule')) return { view:'schedule', scheduleId:query.get('schedule')!, date };
  return { view:'utilities', utilityId:query.get('utility') || undefined,
    month:validDate(`${query.get('month')}-01`) ? query.get('month')! : undefined, statementId:query.get('statement') || undefined };
}
