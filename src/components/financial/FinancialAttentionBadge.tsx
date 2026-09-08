export default function FinancialAttentionBadge({ count, floating = false }: { count: number | null; floating?: boolean }) {
  if (count == null || count === 0) return null;
  return <span aria-label={`${count} ${count === 1 ? 'item needs' : 'items need'} attention`}
    className={`${floating ? 'absolute -right-1 -top-1' : ''} inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full border border-[var(--sp-cream)]/25 bg-[#2c2830] px-1 text-[10px] font-semibold leading-none text-[var(--sp-cream)] tabular-nums`}>
    {count}
  </span>;
}
