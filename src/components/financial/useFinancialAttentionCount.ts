import { useEffect, useState } from 'react';
import { listFinancialActivity } from '../../api';
import type { FinancialActivityQuery } from '../../../shared/types/financial-activity';

/** Count the requested scope, independent of pagination and the selected status tab. */
export default function useFinancialAttentionCount(active = true, revision = 0, scope: Pick<FinancialActivityQuery,'source'|'context'|'runId'> = {}) {
  const scopeKey = JSON.stringify({ source:scope.source,context:scope.context,runId:scope.runId });
  const [count, setCount] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    if (!active) return;
    const refresh = () => setRefreshKey(value => value + 1);
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('ea-financial-event-changed', refresh);
    window.addEventListener('ea-demo-financial-changed', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('ea-financial-event-changed', refresh);
      window.removeEventListener('ea-demo-financial-changed', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [active]);
  useEffect(() => {
    if (!active) return;
    let live = true;
    void listFinancialActivity({ ...JSON.parse(scopeKey), view: 'needs_attention' })
      .then(page => { if (live) setCount(page.total); })
      .catch(() => { if (live) setCount(null); });
    return () => { live = false; };
  }, [active, revision, refreshKey, scopeKey]);
  return count;
}
