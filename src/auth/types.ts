export type GitHubTokenType = "gho" | "ghu" | "github_pat";

export enum TokenSourceTier {
  Environment = 1,
  GitHubCli = 2,
  CopilotCli = 3,
  VsCodeCopilot = 4,
  PluginCache = 5,
}

export interface AuthResult {
  token: string;
  source: string;
  tokenType: GitHubTokenType;
}

export interface CopilotSessionToken {
  token: string;
  expiresAt: number;
  refreshIn: number;
  endpoints: {
    api: string;
    proxy?: string;
    telemetry?: string;
  };
  sku: string;
  chatEnabled: boolean;
}

export interface DeviceFlowProgress {
  userCode: string;
  verificationUri: string;
  expiresInSec: number;
  intervalSec: number;
}

export type AuthErrorCode =
  | "device_flow_disabled"
  | "device_code_request_failed"
  | "device_flow_expired"
  | "device_flow_denied"
  | "device_flow_aborted"
  | "device_flow_error"
  | "copilot_scope_missing"
  | "session_token_unavailable"
  | "session_token_exchange_failed"
  | "secure_storage_unavailable"
  | "http_timeout"
  | "invalid_response";

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly httpStatus?: number;
  readonly tokenSource?: string;
  readonly cause?: unknown;

  constructor(
    code: AuthErrorCode,
    message: string,
    opts: { httpStatus?: number; tokenSource?: string; cause?: unknown } = {}
  ) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.httpStatus = opts.httpStatus;
    this.tokenSource = opts.tokenSource;
    this.cause = opts.cause;
  }
}

export function tokenTypeFromToken(token: string): GitHubTokenType | null {
  if (token.startsWith("gho_")) return "gho";
  if (token.startsWith("ghu_")) return "ghu";
  if (token.startsWith("github_pat_")) return "github_pat";
  return null;
}

export function authResult(token: string, source: string): AuthResult | null {
  const tokenType = tokenTypeFromToken(token.trim());
  return tokenType ? { token: token.trim(), source, tokenType } : null;
}
