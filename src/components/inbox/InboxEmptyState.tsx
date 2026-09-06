import type { ReactNode } from "react";
import "./InboxEmptyState.css";

export default function InboxEmptyState({ icon, title, message, children, action }: {
  icon: ReactNode;
  title: string;
  message: string;
  children?: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="inbox-empty-state">
      <div className="inbox-empty-state-content">
        <div className="inbox-empty-state-icon" aria-hidden="true">{icon}</div>
        <h2>{title}</h2>
        <p>{message}</p>
        {action && <button type="button" className="inbox-empty-state-action" onClick={action.onClick}>{action.label}</button>}
        {children}
      </div>
    </div>
  );
}
