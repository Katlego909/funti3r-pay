import { Flag, UsdcMark, XlmMark } from '../CurrencyIcon.js';

/** Supported payout currencies — coin mark for USDC/XLM, real flags for fiat. */
const CURRENCIES: Array<{ code: string; label?: string; cc?: string; coin?: boolean; xlm?: boolean }> = [
  { code: 'NGN', label: 'Nigerian Naira',      cc: 'ng' },
  { code: 'KES', label: 'Kenyan Shilling',     cc: 'ke' },
  { code: 'GHS', label: 'Ghanaian Cedi',       cc: 'gh' },
  { code: 'ZAR', label: 'South African Rand',  cc: 'za' },
  { code: 'UGX', label: 'Ugandan Shilling',    cc: 'ug' },
  { code: 'USDC', label: 'USD Coin',           coin: true },
  { code: 'XLM', label: 'Stellar Lumens',      xlm: true },
];

/** Infinite-scroll currency carousel ("Pay out in" strip). */
export default function CurrencyStrip() {
  return (
    <section className="strip">
      <p className="strip-label">Pay out in</p>
      <div className="currency-carousel-track-wrap">
        {/* Duplicate the list so the infinite scroll is seamless */}
        {[0, 1].map((pass) => (
          <div key={pass} className="currency-carousel-track" aria-hidden={pass === 1}>
            {CURRENCIES.map((c) => (
              <span key={c.code} className="currency-chip">
                {c.coin ? <UsdcMark size={20} /> : c.xlm ? <XlmMark size={20} /> : <Flag cc={c.cc!} size={20} />}
                {c.code}
                {c.label && <span className="chip-label">{c.label}</span>}
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
