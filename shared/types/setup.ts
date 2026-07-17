export interface SetupStatusResponse {
  claimed: boolean;
}

export interface OwnerClaimRequest {
  password: string;
}

export interface OwnerClaimResponse {
  claimed: true;
  authenticated: true;
}
