export function getScheduleUrl(bill:{scheduleId?:unknown;id?:unknown}|null|undefined,actualBudgetUrl?:string|null):string|null {
  const id=bill?.scheduleId || bill?.id;
  if(!id||!actualBudgetUrl)return null;
  try { const url=new URL(actualBudgetUrl);if(!['https:','http:'].includes(url.protocol))return null;return `${actualBudgetUrl.replace(/\/+$/,'')}/schedules?highlight=${encodeURIComponent(String(id))}`; } catch {return null;}
}
export function payUrlForBill(bill:{scheduleId?:unknown;id?:unknown}|null|undefined,links?:Record<string,string>|null):string|null {
  const id=String(bill?.scheduleId || bill?.id || '');return links?.[id] || null;
}
