import { apiFetch } from './apiFetch';
import type { FinancialActivityReference } from '../../shared/types/financial-activity';
import type { FinancialCorrection, FinancialCorrectionDraft, FinancialCorrectionInspection, FinancialCorrectionKeepPreview, FinancialCorrectionPreview } from '../../shared/types/financial-corrections';

export function inspectFinancialCorrection(reference: FinancialActivityReference): Promise<FinancialCorrectionInspection> {
  return apiFetch('/api/briefing/financial-corrections/inspect', { method: 'POST', body: JSON.stringify({ reference }) });
}
export function previewFinancialCorrection(reference: FinancialActivityReference, draft: FinancialCorrectionDraft): Promise<FinancialCorrectionPreview> {
  return apiFetch('/api/briefing/financial-corrections/preview', { method: 'POST', body: JSON.stringify({ reference, draft }) });
}
export function confirmFinancialCorrection(previewId: string, idempotencyKey: string): Promise<FinancialCorrection> {
  return apiFetch('/api/briefing/financial-corrections/confirm', { method: 'POST', body: JSON.stringify({ previewId, idempotencyKey }) });
}
export function getFinancialCorrection(id: string): Promise<FinancialCorrection> {
  return apiFetch(`/api/briefing/financial-corrections/${encodeURIComponent(id)}`);
}

export function recheckFinancialCorrection(reference: FinancialActivityReference, correctionId: string): Promise<FinancialCorrectionInspection> {
  return apiFetch('/api/briefing/financial-corrections/recheck', { method: 'POST', body: JSON.stringify({ reference, correctionId }) });
}

export function previewKeepFinancialResult(reference: FinancialActivityReference, correctionId: string): Promise<FinancialCorrectionKeepPreview> {
  return apiFetch('/api/briefing/financial-corrections/keep-preview', { method:'POST', body:JSON.stringify({reference,correctionId}) });
}
export function confirmKeepFinancialResult(previewId: string): Promise<FinancialCorrection> {
  return apiFetch('/api/briefing/financial-corrections/keep-confirm', { method:'POST', body:JSON.stringify({previewId}) });
}
