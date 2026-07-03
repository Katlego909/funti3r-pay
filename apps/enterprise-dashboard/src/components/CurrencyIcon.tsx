/** Country flag mark, used for local-currency codes. */
export function Flag({ cc, size = 22 }: { cc: string; size?: number }) {
  return (
    <img
      src={`https://flagcdn.com/${cc}.svg`}
      alt=""
      width={size}
      height={size}
      className="flag-icon"
      loading="lazy"
    />
  );
}

/** USDC coin mark. */
export function UsdcMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      style={{ display: 'block', borderRadius: '50%' }}
    >
      <circle cx="16" cy="16" r="16" fill="#2775CA" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="#fff" strokeWidth="1.4" opacity="0.6" />
      <text
        x="16"
        y="21"
        textAnchor="middle"
        fontSize="13.5"
        fontWeight="800"
        fill="#fff"
        fontFamily="DM Sans, sans-serif"
      >
        $
      </text>
    </svg>
  );
}

/** XLM coin mark. */
export function XlmMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden style={{ display: 'block', borderRadius: '50%' }}>
      <circle cx="16" cy="16" r="16" fill="#000000" />
      <path d="M12.283 7.851A10.154 10.154 0 002.846 18.002c0 .259.01.516.03.773A1.847 1.847 0 01.872 20.56L0 21.005v2.074l2.568-1.309.832-.424.82-.417 14.71-7.496 1.653-.842L24 10.85V8.776l-3.387 1.728-2.89 1.473-13.955 7.108a8.376 8.376 0 01-.07-1.086 8.313 8.313 0 0112.366-7.247l1.654-.843.247-.126a10.154 10.154 0 00-5.682-1.932zM24 12.925L5.055 22.571l-1.653.844L0 25.15v2.072L3.378 25.5l2.89-1.473 13.97-7.117a8.474 8.474 0 01.07 1.092A8.313 8.313 0 017.93 25.248l-.101.054-1.793.914a10.154 10.154 0 0016.119-8.214c0-.26-.01-.522-.03-.78a1.848 1.848 0 011.003-1.785L24 14.992Z" fill="white" transform="scale(0.6) translate(10.5 4)" />
    </svg>
  );
}

/** ISO country code for each local-currency code we support, for the Flag mark. */
export const CURRENCY_FLAG_CC: Record<string, string> = {
  NGN: 'ng', KES: 'ke', GHS: 'gh', ZAR: 'za', UGX: 'ug',
  TZS: 'tz', RWF: 'rw', ETB: 'et', EGP: 'eg', XOF: 'sn', MAD: 'ma',
  MWK: 'mw', ZMW: 'zm',
};

/** Resolves the right mark (coin, XLM, or country flag) for a currency code. */
export function CurrencyIcon({ code, size = 22 }: { code: string; size?: number }) {
  const c = code.toUpperCase();
  if (c === 'USDC') return <UsdcMark size={size} />;
  if (c === 'XLM') return <XlmMark size={size} />;
  const cc = CURRENCY_FLAG_CC[c];
  if (cc) return <Flag cc={cc} size={size} />;
  return null;
}
