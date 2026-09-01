import type { ActualCategoryMetadata, ActualMetadataEntry } from "../../../lib/actualMetadata";
import type { BillCandidate } from "../../../../shared/types/bills";
import type { BillBadgeFormModel } from "../useBillBadgeForm";

export interface BillFieldsProps {
  isMobile: boolean;
  usesStackedLayout: boolean;
  isTransfer: boolean;
  payees: ActualMetadataEntry[];
  accounts: ActualMetadataEntry[];
  categories: ActualCategoryMetadata[];
  editPayee: string;
  setEditPayee: (value: string) => void;
  editAmount: string;
  setEditAmount: (value: string) => void;
  editDue: string;
  setEditDue: (value: string) => void;
  editAccount: string;
  setEditAccount: (value: string) => void;
  editCategory: string;
  setEditCategory: (value: string) => void;
  editFromAccount: string;
  setEditFromAccount: (value: string) => void;
  editToAccount: string;
  handleToAccountChange: (value: string) => void;
  editScheduleName: string;
  setEditScheduleName: (value: string) => void;
  bill: BillCandidate;
}

export interface FeeAndSendRowProps {
  isMobile: boolean;
  usesStackedLayout: boolean;
  feeEnabled: boolean;
  setFeeOverride: (value: boolean) => void;
  parsedFee: number;
  baseAmount: number;
  totalAmount: number;
  detectedFee: { vendor: string; fee: number } | null;
  customFee: string;
  setCustomFee: (value: string) => void;
  canSend: boolean;
  onSend: BillBadgeFormModel["handleSend"];
}

export type BillBadgeFormProps = BillBadgeFormModel & {
  bill: BillCandidate;
  planLoading: boolean;
  isMobile: boolean;
  usesStackedLayout: boolean;
};
