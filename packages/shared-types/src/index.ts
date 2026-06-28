// User types
export enum UserRole {
  ENTERPRISE = 'enterprise',
  WORKER = 'worker',
  ADMIN = 'admin',
}

export enum UserStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DEACTIVATED = 'deactivated',
}

export interface User {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnterpriseUser extends User {
  companyName: string;
  industry?: string;
  taxId?: string;
}

export interface WorkerUser extends User {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  preferredPaymentMethod?: string;
  kycStatus?: 'pending' | 'verified' | 'rejected';
}

// Payment types
export enum PaymentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum PaymentMethod {
  MONEYGRAM = 'moneygram',
  AIRTM = 'airtm',
  PUNTORED = 'puntored',
  STELLAR = 'stellar',
  BANK_TRANSFER = 'bank_transfer',
}

export interface Payment {
  id: string;
  enterpriseId: string;
  workerId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentMethod: PaymentMethod;
  stellarTransactionHash?: string;
  failureReason?: string;
  createdAt: Date;
  completedAt?: Date;
  updatedAt: Date;
}

// Compliance types
export enum ComplianceStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

export interface KYCData {
  userId: string;
  status: ComplianceStatus;
  idType: string;
  idNumber: string;
  dateOfBirth: Date;
  country: string;
  verifiedAt?: Date;
  expiresAt?: Date;
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: Date;
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}

// Auth types
export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  refreshToken?: string;
  user: User;
}

// Wallet types
export enum WalletType {
  WORKER = 'worker',
  ENTERPRISE = 'enterprise',
}

export enum WalletStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
}

export interface Wallet {
  id: string;
  userId: string;
  walletType: WalletType;
  publicKey?: string;
  contractAddress?: string;
  status: WalletStatus;
  createdAt: Date;
  deployedAt?: Date;
  updatedAt: Date;
}

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
  salt: string;
}

export interface WalletDeploymentStatus {
  status: 'idle' | 'deploying' | 'deployed' | 'error';
  contractAddress?: string;
  errorMessage?: string;
}

export interface WalletDeploymentError {
  id: string;
  userId: string;
  errorMessage: string;
  retryCount: number;
  lastRetryAt?: Date;
  resolvedAt?: Date;
  createdAt: Date;
}
