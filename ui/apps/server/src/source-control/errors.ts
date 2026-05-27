// Provider-layer exceptions. Auth errors surface as 401 in source-control-rpc.
export class ProviderAuthError extends Error {
  readonly kind = "provider-auth-error" as const;
  constructor(message: string) {
    super(message);
    this.name = "ProviderAuthError";
  }
}
