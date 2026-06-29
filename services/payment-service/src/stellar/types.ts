/**
 * Stellar Service TypeScript Types
 */

export interface KeypairData {
  publicKey: string;
  secretKey: string;
}

export interface AccountInfo {
  id: string;
  publicKey: string;
  sequenceNumber: string;
  balances: BalanceData[];
  exists: boolean;
}

export interface BalanceData {
  balance: string;
  asset_type: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
  asset_code?: string;
  asset_issuer?: string;
}

export interface PaymentParams {
  fromKeypair: KeypairData;
  toPublicKey: string;
  amount: string;
  memo?: {
    type: 'text' | 'id' | 'hash' | 'return';
    value: string;
  };
  assetCode?: string;
  assetIssuer?: string;
}

export interface PaymentResult {
  transactionHash: string;
  transactionLink: string;
  status: 'success' | 'pending';
  timestamp: string;
  amount: string;
  destination: string;
}

export interface TransactionData {
  id: string;
  hash: string;
  created_at: string;
  source_account: string;
  successful: boolean;
  type_code: number;
  operations_count: number;
}

export interface PaymentOperation {
  type: 'payment' | 'path_payment_strict_receive' | 'path_payment_strict_send';
  from: string;
  to: string;
  amount: string;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}

export interface StreamingTransaction {
  id: string;
  hash: string;
  created_at: string;
  source_account: string;
  successful: boolean;
  operations_count: number;
}

export interface AirdropResult {
  success: boolean;
  accountCreated: boolean;
  message: string;
}
