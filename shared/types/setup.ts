export interface SetupStatusResponse {
  claimed: boolean;
}

export interface OwnerClaimRequest {
  password: string;
  canonicalOrigin: string;
}

export interface OwnerClaimResponse {
  claimed: true;
  authenticated: true;
  recoveryCodes: string[];
}
