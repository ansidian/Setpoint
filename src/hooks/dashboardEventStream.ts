import { isDemoMode } from '../demo/config';

/** One transport for current-dashboard changes; demo publishes only local mutations. */
export function subscribeDashboardEventStream({ changed, connectionChanged, reconnected }: {
  changed: (event: Event) => void;
  connectionChanged: (disconnected: boolean) => void;
  reconnected: () => void;
}): (() => void) | undefined {
  if (isDemoMode()) {
    const update = () => changed(new MessageEvent('dashboard-current-changed', {
      data: JSON.stringify({ source: 'bills', reason: 'financial_event_changed', state: 'current' }),
    }));
    window.addEventListener('ea-demo-financial-changed', update);
    return () => window.removeEventListener('ea-demo-financial-changed', update);
  }
  if (typeof EventSource === 'undefined') return;
  const source = new EventSource('/api/dashboard/current/events');
  let interrupted = false;
  const open = () => {
    connectionChanged(false);
    if (interrupted) { interrupted = false; reconnected(); }
  };
  source.addEventListener('dashboard-current-changed', changed);
  source.addEventListener('open', open);
  source.onerror = () => {
    interrupted = true;
    connectionChanged(true);
    // A terminal handshake failure follows the existing API authentication return.
    // Transient disconnects remain the browser's reconnect responsibility.
    if (source.readyState === (EventSource.CLOSED ?? 2)) {
      source.close();
      window.location.href = '/login';
    }
  };
  return () => {
    source.removeEventListener?.('dashboard-current-changed', changed);
    source.removeEventListener?.('open', open);
    source.onerror = null;
    source.close();
  };
}
