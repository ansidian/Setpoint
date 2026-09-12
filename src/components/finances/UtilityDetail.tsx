import { ArrowRight, Mail } from 'lucide-react';
import type { PaymentStatement } from '../../../shared/types/finances';
import { financialHref } from '../financial/financialNavigation';

/** Direct source actions keep the monthly preview compact. */
export default function UtilityDetail({ statement, onForeground, onPreviewEmail }: {
  statement: PaymentStatement; onForeground: (href: string) => void;
  onPreviewEmail: (statement: PaymentStatement, trigger: HTMLButtonElement) => void;
}) {
  return <div className="fin-month-source-actions">
    <button title={statement.subject || undefined} onClick={event => onPreviewEmail(statement, event.currentTarget)}><Mail size={14}/>Original email</button>
    {statement.activity && <button onClick={() => onForeground(financialHref({}, statement.activity!))}>View saved record <ArrowRight size={14}/></button>}
  </div>;
}
