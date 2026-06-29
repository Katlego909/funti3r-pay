import React, { useState } from 'react';
import { sendPayment, getBalance } from '@funti3r/payment-service';
import '../styles/SendPayment.css';

interface SendPaymentProps {
  senderPublicKey?: string;
  senderSecretKey?: string;
  onSuccess?: (txHash: string) => void;
}

export function SendPayment({ senderPublicKey, senderSecretKey, onSuccess }: SendPaymentProps) {
  const [recipientKey, setRecipientKey] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [senderBalance, setSenderBalance] = useState('0');

  React.useEffect(() => {
    if (senderPublicKey) {
      loadBalance();
    }
  }, [senderPublicKey]);

  const loadBalance = async () => {
    if (!senderPublicKey) return;
    try {
      const balance = await getBalance(senderPublicKey, 'XLM');
      setSenderBalance(balance);
    } catch (err) {
      console.error('Failed to load balance', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!senderPublicKey || !senderSecretKey) {
      setError('Sender keypair not configured');
      return;
    }

    if (!recipientKey.trim()) {
      setError('Recipient public key is required');
      return;
    }

    if (!amount.trim()) {
      setError('Amount is required');
      return;
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError('Amount must be a positive number');
      return;
    }

    if (numAmount > parseFloat(senderBalance)) {
      setError(`Insufficient balance. Available: ${senderBalance} XLM`);
      return;
    }

    setLoading(true);

    try {
      const result = await sendPayment({
        fromKeypair: {
          publicKey: senderPublicKey,
          secretKey: senderSecretKey,
        },
        toPublicKey: recipientKey,
        amount: numAmount.toString(),
        memo: memo ? { type: 'text', value: memo } : undefined,
      });

      setSuccess(`Payment sent! TX: ${result.transactionHash}`);
      setRecipientKey('');
      setAmount('');
      setMemo('');
      await loadBalance();

      if (onSuccess) {
        onSuccess(result.transactionHash);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Payment failed';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="send-payment-container">
      <h2>Send Payment</h2>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="balance-display">
        <span>Balance: {senderBalance} XLM</span>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="recipient">Recipient Public Key</label>
          <input
            id="recipient"
            type="text"
            value={recipientKey}
            onChange={(e) => setRecipientKey(e.target.value)}
            placeholder="G..."
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label htmlFor="amount">Amount (XLM)</label>
          <input
            id="amount"
            type="number"
            step="0.0000001"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label htmlFor="memo">Memo (Optional)</label>
          <input
            id="memo"
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Payment reference"
            maxLength={28}
            disabled={loading}
          />
          <small>{memo.length}/28 characters</small>
        </div>

        <button type="submit" disabled={loading} className="btn btn-primary">
          {loading ? 'Sending...' : 'Send Payment'}
        </button>
      </form>
    </div>
  );
}
