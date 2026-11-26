import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import PublicPageNav from '../components/PublicPageNav.js';
import proof from '../data/proof.json';

const EXPLORER = 'https://stellar.expert/explorer/testnet';
const REPO = 'https://github.com/Katlego909/funti3r-pay';
const WASM_SHA256 = '554940be522f0f7232142b1ccf3c451d46540c117fe9d8728263f1b39bf75790';
const RELEASE = 'v3.0.0-escrow';

// The v3 upgrade (2026-11-26) and an escrow paid in USDC end to end through the platform.
const USDC_ESCROW = [
  { label: 'Contract upgraded in place to the v3 release wasm (address and existing escrows unchanged)', hash: '4c935dadb0c97fab375cddcfe3ab77acd72c1e97cc3b184489fd51ce1d355623' },
  { label: 'Admin allows the USDC Stellar Asset Contract: the only token new escrows accept', hash: 'e0f7d89cfa403cd92c456d1004b46f94f1d6e8182867d48a01eaa10c143b6461' },
  { label: 'Company wallet opens its USDC trustline', hash: 'b7aae6f5afc29850572963f07a8a1671c677ff178a59ea88a6464d57f07963b6' },
  { label: 'Company wallet buys exactly 2 USDC with 3.08 XLM through the Stellar DEX', hash: 'ce72395ab6c625134882d42f07bfb028a58888de563547b6fbbdf8f0aa261373' },
  { label: 'Escrow #29 created: 2 USDC locked in the contract', hash: '45e991e28d1192eef63c5fadeee8e60310d421f1121a0be20faf801e4ea7aa92' },
  { label: 'Employer approves the milestone', hash: '4569210ed93484adcb82bec078d75104ddf586cbdecb796723dedbebe4342e5f' },
  { label: 'Worker claims it: 2 USDC paid from the contract to the worker', hash: '736771c9ecd894fe39879bd1d55f3ecf9bd6f917e9d793a37cbef274a5384199' },
];

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
          <p style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>
            Source:{' '}
            <a href={REPO} target="_blank" rel="noreferrer" style={link}>{REPO}</a>
          </p>
          <p style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>
            Release:{' '}
            <a href={`${REPO}/releases/tag/${RELEASE}`} target="_blank" rel="noreferrer" style={link}>{RELEASE}</a>
            {' '}(the wasm file built by CI, and its sha256)
          </p>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#6b7280', lineHeight: 1.6 }}>
            To verify: download the wasm from the release and compare its sha256 with the hash above. The code on this contract
            on the Stellar testnet has the same hash.
          </p>
        </div>

        <div style={card}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 12px', color: '#111827' }}>Escrow paid in USDC</h2>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {USDC_ESCROW.map((s) => (
              <li key={s.hash} style={{ marginBottom: 14, fontSize: '0.9rem', color: '#374151' }}>
                <div>{s.label}</div>
                <TxLink hash={s.hash} />
              </li>
            ))}
          </ol>
        </div>

        <div style={card}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 12px', color: '#111827' }}>Escrow and compliance gate</h2>
          <p style={{ margin: '0 0 10px', fontSize: '0.88rem', color: '#6b7280' }}>
            Run on the same contract before the v3 upgrade, with native XLM.
          </p>
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
          <p style={{ margin: '0 0 10px', fontSize: '0.88rem', color: '#6b7280', lineHeight: 1.6 }}>
            The payout path is one chain: an escrow claim pays into the worker's wallet balance, and a cash-out is taken from that
            balance. The cash-out below was a separate run on the MoneyGram sandbox, so no cash was dispensed.
          </p>
          <p style={{ margin: '0 0 6px', fontSize: '0.9rem', color: '#374151' }}>{MONEYGRAM.label}</p>
          <TxLink hash={MONEYGRAM.hash} />
        </div>
      </div>
    </div>
  );
}
