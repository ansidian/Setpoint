export interface CanonicalCallbackImpact {
  provider: string;
  previousUrl: string | null;
  nextUrl: string;
}

export interface CanonicalOriginImpact {
  currentOrigin: string | null;
  proposedOrigin: string;
  affectedPasskeys: number;
  callbacks: CanonicalCallbackImpact[];
}

export interface CanonicalOriginStatus extends CanonicalOriginImpact {
  recentAuth: boolean;
}
