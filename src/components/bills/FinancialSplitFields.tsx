import { formatImportAmount } from '../financial/transactionImportReviewModel';
import { Plus, X } from 'lucide-react';
import { useId } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import SearchableDropdown from '../shared/SearchableDropdown';
import type { FinancialCompletionFields } from './financialCompletionDraft';

const actionClass = 'transition-transform hover:-translate-y-px focus-visible:-translate-y-px focus-visible:ring-2 focus-visible:ring-primary active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none';
export default function FinancialSplitFields({ splits, categories, disabled, onChange, remainingCents, onDistribute }: {
  remainingCents: number | null;
  onDistribute?: () => void;
  splits: FinancialCompletionFields['splits'];
  categories: Array<{ id: string; name: string }>;
  disabled: boolean;
  onChange: (splits: FinancialCompletionFields['splits']) => void;
}) {
  const id = useId();
  const edit = (index: number, changes: Partial<FinancialCompletionFields['splits'][number]>) => onChange(splits.map((split, i) => i === index ? { ...split, ...changes } : split));
  return <fieldset className="min-w-0 space-y-3 rounded-md border border-white/15 p-3">
    <legend className="px-1 text-xs font-semibold">Split this purchase</legend>
    <p className="text-[11px] leading-relaxed text-foreground/75">One transaction, with a shared account, payee and date. Allocate the total outflow across these splits.</p>
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white/5 p-2.5">
      <p role="status" aria-live="polite" className={`text-xs font-medium ${remainingCents !== null && remainingCents < 0 ? 'text-[var(--sp-rose)]' : 'text-foreground'}`}>
        {remainingCents === null ? 'Enter valid amounts to check the balance.' : remainingCents === 0 ? 'Fully allocated' : `${formatImportAmount(Math.abs(remainingCents))} ${remainingCents > 0 ? 'left to split' : 'over the total'}`}
      </p>
      <Button type="button" variant="outline" className={actionClass} disabled={disabled || !onDistribute} onClick={onDistribute}>Distribute remaining evenly</Button>
    </div>
    {splits.map((split, index) => <div key={index} className="space-y-2 border-b border-white/10 pb-3 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">Split {index + 1}</span>
        <Button type="button" size="icon" variant="ghost" className={actionClass} disabled={disabled} aria-label={`Remove split ${index + 1}`} onClick={() => onChange(splits.filter((_, i) => i !== index))}><X size={14} /></Button>
      </div>
      <label htmlFor={`${id}-${index}-notes`} className="block text-[11px] text-foreground/85">Order or description</label>
      <Input id={`${id}-${index}-notes`} value={split.notes} maxLength={2000} onChange={event => edit(index, { notes: event.target.value })} disabled={disabled} className="h-9 text-base sm:text-xs" placeholder="Order number or what you bought" />
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-end gap-2">
        <div className="min-w-0 space-y-1"><label htmlFor={`${id}-${index}-amount`} className="block text-[11px] text-foreground/85">Amount (USD)</label>
          <Input id={`${id}-${index}-amount`} type="number" min="0.01" step="0.01" required value={split.amount} onChange={event => edit(index, { amount: event.target.value })} disabled={disabled} className="h-9 w-full min-w-0 text-base sm:text-xs" /></div>
        <div className="min-w-0 space-y-1"><span className="block text-[11px] text-foreground/85">Category (optional)</span>
          <SearchableDropdown ariaLabel={`Split ${index + 1} category`} options={[{ id: '', name: 'No category' }, ...categories]} value={split.categoryId} onChange={categoryId => edit(index, { categoryId })} disabled={disabled} placeholder="No category" /></div>
      </div>
    </div>)}
    <Button type="button" variant="outline" className={actionClass} disabled={disabled || splits.length >= 30} onClick={() => onChange([...splits, { amount: '', categoryId: '', notes: '' }])}><Plus size={14} />Add split</Button>
    <p className="text-[11px] leading-relaxed text-foreground/75">Use at least two splits. After recording, edit split details in Actual.</p>
  </fieldset>;
}
