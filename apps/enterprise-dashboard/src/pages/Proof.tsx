import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import PublicPageNav from '../components/PublicPageNav.js';
import proof from '../data/proof.json';

const EXPLORER = 'https://stellar.expert/explorer/testnet';
const REPO = 'https://github.com/Katlego909/funti3r-pay';
const WASM_SHA256 = '091872ea559f743bc0b3b21001f68527c76db946e9d2ccddd24822b895f985d5';

// MoneyGram Ramps sandbox cash-out of 10 USDC (completed 2026-10-08, reference 63361763).
const MONEYGRAM = {
  label: 'Worker cash-out through MoneyGram Ramps (sandbox): 10 USDC sent to the anchor, status completed',
  hash: '089989c92093d294347544ac24bc308f338621a33ab737da36d0c0310352ba47',
};

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8rem', wordBreak: 'break-all' as const };
const card = { background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 24px', marginBottom: 24 };
const link = { color: '#2563eb' };

function TxLink({ hash }: { hash: string }) {
  return (
    <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer" style={{ ...mono, ...link }}>
      {hash}
    </a>
  );
}

export default function Proof() {
  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#fafafa', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <Helmet>
        <title>On-chain proof | Funti3rPay</title>
        <meta name="description" content="Stellar testnet transactions for the Funti3r escrow contract, compliance gate and anchor cash-out." />
      </Helmet>
      <PublicPageNav />

      <div style={{ maxWidth: 820, margin: '0 auto', padding: '52px 24px 96px' }}>
        <h1 style={{ fontSize: '1.9rem', fontWeight: 700, color: '#111827', margin: '0 0 12px' }}>On-chain proof</h1>
        <p style={{ fontSize: '0.97rem', color: '#4b5563', lineHeight: 1.75, margin: '0 0 32px' }}>
          Every transaction below is on the Stellar {proof.network}. The escrow contract only lets a worker be paid while the
          compliance authority holds a live clearance for them, and the same authority can freeze an escrow or return its
          unclaimed funds to the enterprise. Last run: {new Date(proof.generatedAt).toUTCString()}.
        </p>

        <div style={card}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 12px', color: '#111827' }}>Contract</h2>
          <p style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>
            Address:{' '}
            <a href={`${EXPLORER}/contract/${proof.contract}`} target="_blank" rel="noreferrer" style={{ ...mono, ...link }}>
              {proof.contract}
            </a>
          </p>
          <p style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>Wasm sha256: <span style={mono}>{WASM_SHA256}</span></p>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            Source and releases:{' '}
            <a href={REPO} target="_blank" rel="noreferrer" style={link}>{REPO}</a>
          </p>
        </div>

        <div style={card}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 12px', color: '#111827' }}>Escrow and compliance gate</h2>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {proof.steps.map((s) => (
              <li key={s.hash} style={{ marginBottom: 14, fontSize: '0.9rem', color: '#374151' }}>
                <div>{s.label}</div>
                <TxLink hash={s.hash} />
              </li>
            ))}
          </ol>
        </div>

        <div style={card}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 12px', color: '#111827' }}>Attempts the contract refused</h2>
          <p style={{ margin: '0 0 10px', fontSize: '0.88rem', color: '#6b7280' }}>
            A refused call is rejected when the transaction is simulated, so it never lands on-chain and has no hash.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.9rem', color: '#374151' }}>
            {proof.blocked.map((b) => <li key={b} style={{ marginBottom: 6 }}>{b}</li>)}
          </ul>
        </div>

        <div style={card}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 12px', color: '#111827' }}>Anchor cash-out</h2>
          <p style={{ margin: '0 0 6px', fontSize: '0.9rem', color: '#374151' }}>{MONEYGRAM.label}</p>
          <TxLink hash={MONEYGRAM.hash} />
        </div>
      </div>
    </div>
  );
}
