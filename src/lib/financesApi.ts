import type { FinancialConnectionConfiguration, FinancialConnectionSave } from "../../shared/types/financial-connections";
import type { FINANCIAL_PROVIDER_CATALOG } from "../../shared/types/financial-parsers";
import type { PaymentOrganization } from '../../shared/types/payment-groups';
import { apiFetch } from './apiFetch';
import type { FinanceWorkspace, JournalRange, UtilityIdentity, UtilityMappingSettings, UtilityMappingUpdate } from '../../shared/types/finances';
export const getFinances = ():Promise<FinanceWorkspace> => apiFetch('/api/briefing/finances');
export const getFinanceJournal = (start:string,end:string,transactionId?:string):Promise<JournalRange> => apiFetch(`/api/briefing/finances/journal?${new URLSearchParams({ start,end,...(transactionId ? { transactionId } : {}) })}`);

export const getUtilityMappings = ():Promise<UtilityMappingSettings> => apiFetch('/api/briefing/finances/utility-mappings');
export const updateUtilityMapping = (id:string,update:UtilityMappingUpdate):Promise<UtilityIdentity> => apiFetch(`/api/briefing/finances/utility-mappings/${encodeURIComponent(id)}`, {method:'PUT',body:JSON.stringify(update)});

export const savePaymentOrganization = (organization: PaymentOrganization):Promise<PaymentOrganization> => apiFetch('/api/briefing/finances/payment-groups', {method:'PUT',body:JSON.stringify(organization)});

export type FinancialConnectionsResponse = FinancialConnectionConfiguration & { catalog?: typeof FINANCIAL_PROVIDER_CATALOG };
export const getFinancialConnections = (): Promise<FinancialConnectionsResponse> => apiFetch("/api/briefing/financial-connections");
export const saveFinancialConnections = (value: FinancialConnectionSave): Promise<FinancialConnectionsResponse> => apiFetch("/api/briefing/financial-connections", { method: "PUT", body: JSON.stringify(value) });
