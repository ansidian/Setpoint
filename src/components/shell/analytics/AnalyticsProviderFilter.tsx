import Dropdown from "@/components/shared/Dropdown";
import { formatCompactNumber, formatUsdEstimate } from './analyticsFormat';
import type { AnalyticsProvider, ProviderComparison } from './analyticsProviderData';

const PROVIDERS = [{ id: 'all', label: 'All providers' }, { id: 'openai', label: 'OpenAI' }, { id: 'anthropic', label: 'Anthropic' }] as const;

export default function AnalyticsProviderFilter({ value, onChange }: {
  value: AnalyticsProvider;
  onChange: (provider: AnalyticsProvider) => void;
}) {
  return (
    <div className="w-32 shrink-0 [&_[data-slot=select-trigger]]:px-2 [&_[data-slot=select-trigger]]:text-[11px] sm:[&_[data-slot=select-trigger]]:min-h-7 sm:[&_[data-slot=select-trigger]]:py-1 motion-safe:[&_[data-slot=select-trigger]]:hover:-translate-y-px motion-safe:[&_[data-slot=select-trigger]]:focus-visible:-translate-y-px">
      <Dropdown options={PROVIDERS.map(({ id, label }) => ({ id, name: label }))} value={value}
        ariaLabel="AI provider" onChange={(next) => {
          if (next === 'all' || next === 'openai' || next === 'anthropic') onChange(next);
        }} />
    </div>
  );
}

export function AnalyticsProviderComparison({ comparison }: { comparison: ProviderComparison }) {
  return (
        <table className="w-full text-left text-[11px] tabular-nums">
          <caption className="sr-only">Provider comparison for this section</caption>
          <thead className="text-[10px] text-muted-foreground">
            <tr><th scope="col" className="pb-1 font-medium">Provider</th><th scope="col" className="pb-1 text-right font-medium">Calls</th><th scope="col" className="pb-1 text-right font-medium">Est. cost</th></tr>
          </thead>
          <tbody>
            {PROVIDERS.filter(({ id }) => id !== 'all').map(({ id, label }) => {
              const row = comparison[id as 'openai' | 'anthropic'];
              return (
                <tr key={id} className="border-t border-white/[0.06]">
                  <th scope="row" className="py-1.5 font-medium text-foreground">{label}</th>
                  <td className="py-1.5 text-right text-muted-foreground">{formatCompactNumber(row.calls)}</td>
                  <td className="py-1.5 text-right text-foreground">{row.calls === 0 ? formatUsdEstimate(0) : row.cost === null ? 'Unavailable' : formatUsdEstimate(row.cost)}{row.unpricedCalls && row.cost !== null ? ' (partial)' : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
  );
}
