import type { PaymentPresentationRow } from './paymentPresentationModel';
export type PaymentSortColumn = 'name' | 'date' | 'amountCents';
export interface PaymentSort { column: PaymentSortColumn; direction: 'asc' | 'desc' }
export const paymentRowDate=(row:PaymentPresentationRow):string|null=>['paid','received','transferred'].includes(row.status)?row.paymentDate:row.dueDate;

/** Today/future dates precede past dates; missing values stay last. Stable identities break ties. */
export function sortPaymentRows(rows: PaymentPresentationRow[], sort: PaymentSort, today: string): PaymentPresentationRow[] {
  return [...rows].sort((a,b)=>{
    const first=sort.column==='date'?paymentRowDate(a):a[sort.column],second=sort.column==='date'?paymentRowDate(b):b[sort.column];
    if(first==null && second!=null)return 1;
    if(second==null && first!=null)return -1;
    if (sort.column==='date' && typeof first==='string' && typeof second==='string') {
      const firstPast=first<today,secondPast=second<today;
      if(firstPast!==secondPast)return firstPast?1:-1;
    }
    const comparison=first==null || second==null ? 0 : typeof first==='number' && typeof second==='number' ? first-second : String(first).localeCompare(String(second));
    return comparison*(sort.direction==='asc'?1:-1) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}
