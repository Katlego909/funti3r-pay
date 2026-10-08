import { Helmet } from 'react-helmet-async';
import LegalLayout from '../components/LegalLayout.js';

const UPDATED = 'July 2, 2026';

const sections = [
  {
    heading: 'Our Commitment',
    content: (
      <p>
        Funti3r Technologies is committed to the highest standards of Anti-Money Laundering (AML), Counter-Financing of
        Terrorism (CFT), and sanctions compliance. We recognise that cross-border payment platforms carry elevated risks
        of financial crime, and we take active measures to prevent the misuse of our Service. Our compliance programme
        is designed to meet the requirements of South Africa's Financial Intelligence Centre Act (FICA), the Financial
        Action Task Force (FATF) recommendations, and equivalent regulations in all jurisdictions where we operate.
      </p>
    ),
  },
  {
    heading: 'Customer Identification and Verification (KYC)',
    content: (
      <>
        <p>
          Before receiving escrow payments, workers must complete our Know Your Customer (KYC) process. This includes:
        </p>
        <ul style={{ paddingLeft: '20px', margin: '10px 0 0' }}>
          <li style={{ marginBottom: '6px' }}><strong>Individuals (Workers):</strong> full name, government ID type and number, date of birth, country, address and bank details, submitted by the worker. Each submission is screened against the sanctions list (below) and then approved by an administrator of the company that engages the worker, or automatically on our test network. Approvals expire after 12 months.</li>
          <li style={{ marginBottom: '6px' }}><strong>Businesses (Employers):</strong> the company's registered name and its owner's name are screened against the sanctions list before an escrow is funded.</li>
        </ul>
        <p style={{ marginTop: '12px' }}>
          We do not yet verify identity documents or take selfies ourselves; document verification is planned. Cash-outs
          through our payout partner, MoneyGram, are separately identity-verified by MoneyGram. Submitted KYC details are
          encrypted at rest, visible only to the worker, the administrators of their company and our platform
          administrators, and every decision is recorded. We reserve the right to request additional information at any
          time and to refuse service where verification cannot be satisfactorily completed.
        </p>
      </>
    ),
  },
  {
    heading: 'Enhanced Due Diligence',
    content: (
      <p>
        We apply Enhanced Due Diligence (EDD) to accounts presenting elevated risk factors, including: politically
        exposed persons (PEPs) and their close associates, accounts transacting above defined volume thresholds,
        businesses operating in high-risk industries or jurisdictions, and accounts that trigger automated risk alerts.
        EDD may require additional documentation, source-of-funds declarations, senior management approval, and
        ongoing enhanced monitoring.
      </p>
    ),
  },
  {
    heading: 'Transaction Monitoring',
    content: (
      <p>
        All transactions on the Funti3rPay platform are subject to automated and manual monitoring for suspicious
        patterns. Our systems screen for indicators including: unusual payment volumes or frequencies relative to
        account history, payments to or from high-risk jurisdictions, structuring (deliberate splitting of transactions
        to avoid thresholds), and transactions inconsistent with the stated business purpose. Flagged transactions may
        be delayed, held, or declined pending investigation.
      </p>
    ),
  },
  {
    heading: 'Sanctions Screening',
    content: (
      <p>
        Funti3rPay screens the names of workers and of the companies that fund escrows against the US Office of Foreign
        Assets Control (OFAC) Specially Designated Nationals list, refreshed daily. Every existing customer is
        re-screened each time the list is refreshed. The United Nations, UK and EU lists are not yet included. A match
        blocks the person from receiving, or the company from funding, escrow payments pending compliance review, and
        only a platform administrator can clear it. Providing false information to circumvent sanctions screening is a
        criminal offence.
      </p>
    ),
  },
  {
    heading: 'Restricted Jurisdictions',
    content: (
      <p>
        Funti3rPay does not currently offer services to users in jurisdictions subject to comprehensive international
        sanctions or those designated as high-risk and non-cooperative by the FATF. This list is reviewed quarterly.
        Even in non-sanctioned jurisdictions, we may restrict services to specific transaction types or require
        additional verification depending on the prevailing regulatory environment. Users are responsible for
        ensuring their use of the Service complies with their local laws.
      </p>
    ),
  },
  {
    heading: 'Suspicious Activity Reporting',
    content: (
      <p>
        Where we identify or reasonably suspect money laundering, terrorist financing, or other financial crimes, we
        are obligated by law to file a Suspicious Activity Report (SAR) or Suspicious Transaction Report (STR) with
        the relevant Financial Intelligence Unit (FIU) — such as South Africa's Financial Intelligence Centre (FIC).
        We are legally prohibited from informing ("tipping off") the subject of the report that a report has been
        filed. Funti3rPay staff and systems are designed to identify red flags and escalate for SAR filing without
        undue delay.
      </p>
    ),
  },
  {
    heading: 'Record Keeping',
    content: (
      <p>
        We maintain comprehensive records of all customer identification documents, transaction records, monitoring
        alerts, and compliance decisions for a minimum of 5 years from the date of the last transaction, or such
        longer period as required by applicable law. Records are stored securely with access restricted to authorised
        personnel and are available for inspection by regulators upon lawful request.
      </p>
    ),
  },
  {
    heading: 'Stellar Network and Blockchain Compliance',
    content: (
      <p>
        Payments are settled on the Stellar public blockchain, which means all transactions are permanently and
        immutably recorded on a publicly auditable ledger. While Stellar wallet addresses are pseudonymous, all
        on-chain activity associated with your Funti3rPay account is linked to your verified identity in our internal
        records. We cooperate fully with law enforcement requests that comply with applicable legal process, including
        the provision of identity records linked to wallet addresses involved in investigations.
      </p>
    ),
  },
  {
    heading: 'Account Restrictions and Asset Freezing',
    content: (
      <p>
        We reserve the right to suspend, restrict, or terminate any account and to freeze associated funds where we
        reasonably suspect a breach of our compliance policies, at the direction of a regulatory or law enforcement
        authority, or where required to comply with a court order. We will endeavour to notify affected users of
        restrictions to the extent permitted by law; however, where a legal obligation of confidentiality applies
        (such as a production order or "tipping off" prohibition), we may not be able to provide such notice.
      </p>
    ),
  },
  {
    heading: 'Reporting Compliance Concerns',
    content: (
      <p>
        If you become aware of activity on the Funti3rPay platform that you suspect may be fraudulent, illegal, or
        in breach of our compliance policies, please report it immediately to our compliance team at{' '}
        <a href="mailto:legal@funti3r.xyz" style={{ color: '#374151' }}>legal@funti3r.xyz</a>.
        Reports can be made anonymously. We take all reports seriously and will investigate promptly. Retaliation
        against persons who report compliance concerns in good faith is strictly prohibited.
      </p>
    ),
  },
];

export default function Compliance() {
  return (
    <>
      <Helmet>
        <title>AML & Compliance Policy | Funti3rPay</title>
        <meta name="description" content="Funti3rPay's Anti-Money Laundering, Counter-Financing of Terrorism, and sanctions compliance policy for our cross-border payroll platform." />
      </Helmet>
      <LegalLayout
        title="AML & Compliance Policy"
        updated={UPDATED}
        intro="Funti3rPay is built on the belief that financial infrastructure for African workers must be both accessible and trustworthy. This policy sets out our obligations and controls to prevent financial crime, protect our users, and comply with anti-money laundering and counter-terrorism financing laws across our operating jurisdictions."
        sections={sections}
      />
    </>
  );
}
