import { apiFetch } from './apiFetch';
import type { FinancialActivityReference } from '../../shared/types/financial-activity';
import type { FinancialCorrection, FinancialCorrectionDraft, FinancialCorrectionPreview } from '../../shared/types/financial-corrections';

// Demo deliberately returns DEMO_API_UNHANDLED for these contracts until the fictional editor is integrated.
export function previewFinancialCorrection(reference: FinancialActivityReference, draft: FinancialCorrectionDraft): Promise<FinancialCorrectionPreview> {
  return apiFetch('/api/briefing/financial-corrections/preview', { method: 'POST', body: JSON.stringify({ reference, draft }) });
}
export function confirmFinancialCorrection(previewId: string, idempotencyKey: string): Promise<FinancialCorrection> {
  return apiFetch('/api/briefing/financial-corrections/confirm', { method: 'POST', body: JSON.stringify({ previewId, idempotencyKey }) });
}
export function getFinancialCorrection(id: string): Promise<FinancialCorrection> {
  return apiFetch(`/api/briefing/financial-corrections/${encodeURIComponent(id)}`);
}
