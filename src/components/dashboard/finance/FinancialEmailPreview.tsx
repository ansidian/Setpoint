import { useRef } from "react";
import { X } from "lucide-react";
import AnchoredFloatingPanel from "../../shared/pickers/AnchoredFloatingPanel";
import EmailBodyPane from "../../inbox/reader/EmailBodyPane";
import useEmailBody from "../../inbox/reader/useEmailBody";
import type { DashboardFinanceActivityItem } from "../../../../shared/types/dashboard-finance";

export default function FinancialEmailPreview({ item, anchor, onClose }: {
  item: DashboardFinanceActivityItem;
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const anchorRef = useRef<HTMLElement | null>(anchor);
  const email = { uid: item.emailUid };
  const state = useEmailBody(email);
  return <AnchoredFloatingPanel anchorRef={anchorRef} onClose={onClose} width={560} height={480} ariaLabel="Source email" hideTitle style={{ height: "min(480px, calc(100dvh - 40px))", overflow: "hidden" }}>
    <div className="dashboard-finance-email">
      <div className="dashboard-finance-heading">
        <h3>{item.payee || "Source email"}</h3>
        <button type="button" className="dashboard-finance-button" aria-label="Close source email" onClick={onClose}><X size={15} /></button>
      </div>
      <EmailBodyPane state={state} email={email} />
    </div>
  </AnchoredFloatingPanel>;
}
