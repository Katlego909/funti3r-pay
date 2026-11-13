import { Helmet } from 'react-helmet-async';
import LegalLayout from '../components/LegalLayout.js';

const UPDATED = 'November 13, 2026';

const sections = [
  {
    heading: 'Our Commitment',
    content: (
      <p>
        Funti3r Technologies is committed to Anti-Money Laundering (AML), Counter-Financing of Terrorism (CFT) and
        sanctions compliance. We recognise that cross-border payment platforms carry elevated risks of financial crime,
        and we build controls against misuse into the Service itself. Funti3rPay currently runs on the Stellar test
        network and does not move real money. Before we handle real funds we will operate through a licensed partner,
        under South Africa's Financial Intelligence Centre Act (FICA), the Financial Action Task Force (FATF)
        recommendations and the rules of each country we serve. This page describes the controls that exist today and
        says plainly where a control is still planned.
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
    heading: 'Checks Before Money Moves',
    content: (
      <>
        <p>
          A worker's KYC approval and sanctions status are checked again, at the moment of the action, before an escrow is
          created, before a milestone is approved or claimed, before a cash-out, and before a direct or batch payment.
          A worker who is not cleared cannot be paid, and our escrow contract on Stellar refuses a payout unless a current
          clearance for that worker is recorded on-chain.
        </p>
        <p style={{ marginTop: '12px' }}>
          Every payment is recorded with its Stellar transaction, and our records are regularly checked against the
          ledger in both directions.
        </p>
        <p style={{ marginTop: '12px' }}>
          Not yet in place: screening for politically exposed persons (PEPs), enhanced due diligence for higher-risk
          accounts, and automated monitoring for suspicious patterns such as unusual volumes or structuring. These will be
          in place, with our licensed partner, before we handle real funds.
        </p>
      </>
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
        Funti3rPay does not offer, and will not offer, services to users in jurisdictions subject to comprehensive
        international sanctions or designated as high-risk and non-cooperative by the FATF. The Service does not yet
        block these jurisdictions automatically; that check will be in place before we handle real funds. We may
        restrict services to specific transaction types or require additional verification depending on the
        regulatory environment. Users are responsible for ensuring their use of the Service complies with their local
        laws.
      </p>
    ),
  },
  {
    heading: 'Suspicious Activity Reporting',
    content: (
      <p>
        Where we identify or reasonably suspect money laundering, terrorist financing, or other financial crimes, we
        will report it to the relevant Financial Intelligence Unit (FIU), such as South Africa's Financial
        Intelligence Centre (FIC), through our licensed partner once we handle real funds. The law prohibits informing
        ("tipping off") the subject of such a report that it has been filed.
      </p>
    ),
  },
  {
    heading: 'Record Keeping',
    content: (
      <p>
        We keep the KYC details customers submit, every KYC and sanctions decision, and every transaction record. Once
        we handle real funds we will keep these records for at least 5 years from the date of the last transaction, or
        longer where the law requires. KYC details are encrypted at rest, access is restricted to authorised people,
        and records are available to regulators on lawful request.
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
