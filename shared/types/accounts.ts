export type AccountId = string;

export interface AccountSummary {
  id: AccountId;
  type: string;
  email: string;
  label: string;
  color: string | null;
  icon: string | null;
  calendar_enabled: number;
  sort_order: number;
  created_at: string;
  needs_reauth: boolean;
}

export type AccountsResponse = AccountSummary[] | { accounts: AccountSummary[] };

export interface AccountPatchRequest {
  calendar_enabled?: boolean;
  label?: string;
  color?: string;
  icon?: string | null;
}

export interface ICloudAccountRequest {
  email: string;
  password: string;
  label?: string;
  color?: string;
}

export interface ICloudAccountResponse {
  id: AccountId;
  email: string;
  label: string;
}

export interface GmailAuthUrlResponse {
  url: string;
}

export interface GmailOAuthCallbackResult {
  email: string;
  accountId: AccountId;
}

export interface AccountMutationResponse {
  success: true;
}

export interface ApiTokenMetadata {
  id: string | number;
  label: string;
  scopes: string[];
  created_at: number;
  last_used_at: number | null;
  expires_at: number;
}

export interface CreateApiTokenResponse {
  token: string;
  label: string;
  scopes: string[];
  expires_at: number;
}

export interface PasskeyMetadata {
  id: number;
  credentialId: string;
  userId: string;
  label: string;
  signCount: number;
  transports: string[];
  backedUp: boolean | null;
  credentialDeviceType: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

export type OwnerAuthMode = "password_or_passkey" | "password_plus_passkey";

export interface RecoveryCodeStatus {
  remaining: number;
  generatedAt: number | null;
}

export interface PasskeyListResponse {
  enforcementActive: boolean;
  authMode: OwnerAuthMode;
  recentAuth: boolean;
  recovery: RecoveryCodeStatus;
  passkeys: PasskeyMetadata[];
}

export interface PasskeyRegistrationResponse {
  enforcementActive: boolean;
  authMode: OwnerAuthMode;
  passkey: PasskeyMetadata;
}

export interface PasskeyDeleteResponse extends PasskeyListResponse {
  success: true;
}

export interface RecoveryCodesResponse {
  recoveryCodes: string[];
}

export interface OwnerRecoveryResponse extends RecoveryCodesResponse {
  authenticated: true;
}
