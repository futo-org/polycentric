import { Verifier } from './verifier';

export interface Platform {
  name: string;
  verifiers: Verifier[];
  version: number;
}

export interface TokenResponse {
  username: string;
  token: string;
}

export interface ClaimField {
  key: number;
  value: string;
}
