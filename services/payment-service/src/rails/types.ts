export interface RailQuoteParams {
  amount: number;
  sourceCurrency: string;
  destinationCurrency: string;
  destinationCountry: string;
}

export interface RailQuote {
  rail: string;
  sourceCurrency: string;
  destinationCurrency: string;
  exchangeRate: number;
  fee: number;
  estimatedDeliveryMinutes: number;
  quoteId?: string;
  expiresAt?: Date;
}

export interface RailPaymentParams {
  paymentId: string;
  amount: number;
  sourceCurrency: string;
  destinationCurrency: string;
  destinationCountry: string;
  recipientName: string;
  recipientAccount?: string; // phone, account number, etc.
  stellarRecipientAddress?: string; // Classic Stellar account or contract address
  quoteId?: string;
  metadata?: Record<string, string>;
}

export interface RailResult {
  success: boolean;
  providerReference: string;
  stellarTxHash?: string;
  pinCode?: string;
  status: 'completed' | 'pending' | 'failed';
  estimatedCompletionAt?: Date;
}

export interface IPaymentRail {
  readonly name: string;
  readonly supportedCountries: string[];
  getQuote(params: RailQuoteParams): Promise<RailQuote>;
  sendPayment(params: RailPaymentParams): Promise<RailResult>;
}
