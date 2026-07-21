export interface SetupStatusResponse {
  claimed: boolean;
}

export interface OwnerClaimResponse {
  claimed: true;
  authenticated: true;
  recoveryCodes: string[];
}
