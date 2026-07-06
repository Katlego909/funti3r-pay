import { useState } from 'react';

const faqs = [
  {
    question: 'Which currencies can workers receive?',
    answer:
      'Workers can be paid in USDC or in local currencies — Nigerian Naira (NGN), Kenyan Shilling (KES), Ghanaian Cedi (GHS), South African Rand (ZAR) and Ugandan Shilling (UGX), with more added regularly. Employers simply send USD and we convert at the live exchange rate.',
  },
  {
    question: 'How fast are payments?',
    answer:
      'Payments settle on the Stellar network in a few seconds — any time of day, every day. No bank cut-off times, no multi-day batch windows.',
  },
  {
    question: 'How secure is my account?',
    answer:
      'Sign-in uses passkeys (WebAuthn) — there are no passwords to phish or leak. Account keys are encrypted at rest, and every payout is a verifiable on-chain transaction.',
  },
  {
    question: 'How does the currency conversion work?',
    answer:
      'You send a USD amount; the worker receives their chosen currency, converted at the live market rate and delivered on-chain via Stellar path payments. The exact amount and rate are shown before you send and recorded on every receipt.',
  },
  {
    question: 'Can workers withdraw their funds?',
    answer:
      'Yes. Funds land in the worker’s own Stellar account, which they control. From there they can hold, convert, or move their balance whenever they want.',
  },
  {
    question: 'How much does it cost?',
    answer:
      'Settlement runs on Stellar, where network fees are a fraction of a cent per transaction. Platform pricing is transparent and scales with volume — talk to us for enterprise rates.',
  },
];

/** FAQ accordion — one question open at a time. */
export default function FaqSection() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <section className="faq">
      <div className="section-header">
        <h3>Frequently asked questions</h3>
        <p>Everything you need to know</p>
      </div>
      <div className="faq-container">
        {faqs.map((faq, index) => (
          <div key={index} className="faq-item">
            <button
              className={`faq-question ${openFaq === index ? 'open' : ''}`}
              onClick={() => setOpenFaq(openFaq === index ? null : index)}
              aria-expanded={openFaq === index}
            >
              <span>{faq.question}</span>
              <span className="faq-toggle">{openFaq === index ? '−' : '+'}</span>
            </button>
            {openFaq === index && (
              <div className="faq-answer">
                <p>{faq.answer}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
