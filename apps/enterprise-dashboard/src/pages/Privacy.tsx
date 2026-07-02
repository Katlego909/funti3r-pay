import LegalLayout from '../components/LegalLayout.js';

const UPDATED = 'July 2, 2026';

const sections = [
  {
    heading: 'Introduction',
    content: (
      <p>
        Funti3r Technologies ("we", "us", "our") is committed to protecting the personal information of all users of the
        Funti3rPay platform. This Privacy Policy explains what data we collect, why we collect it, how we use and share
        it, and the rights you have over your information. We comply with the Protection of Personal Information Act
        (POPIA) of South Africa, the EU General Data Protection Regulation (GDPR), the Nigeria Data Protection
        Regulation (NDPR), and other applicable data protection laws in our operating jurisdictions.
      </p>
    ),
  },
  {
    heading: 'Information We Collect',
    content: (
      <>
        <p><strong>Identity and contact data:</strong> Full name, email address, country of residence, and date of
        birth collected during account registration and KYC verification.</p>
        <p style={{ marginTop: '10px' }}><strong>Identity verification documents:</strong> Government-issued ID, proof
        of address, and business registration documents submitted during KYC review. These are processed by our
        compliance team and trusted third-party verification providers.</p>
        <p style={{ marginTop: '10px' }}><strong>Financial data:</strong> Stellar wallet addresses, payment amounts,
        currency preferences, and transaction history generated through your use of the platform.</p>
        <p style={{ marginTop: '10px' }}><strong>Technical data:</strong> IP address, device identifiers, browser type,
        WebAuthn credential public keys, session data, and access logs.</p>
        <p style={{ marginTop: '10px' }}><strong>Usage data:</strong> Features accessed, pages visited, actions taken
        within the platform, and timestamps of activity.</p>
      </>
    ),
  },
  {
    heading: 'How We Use Your Information',
    content: (
      <ul style={{ paddingLeft: '20px', margin: 0 }}>
        {[
          'To create and maintain your account and authenticate you securely',
          'To process and settle cross-border payroll payments on the Stellar network',
          'To verify your identity and comply with KYC/AML legal obligations',
          'To detect, investigate, and prevent fraud, money laundering, and prohibited activities',
          'To generate payslips, payment reports, and transaction records',
          'To send transactional notifications (payment confirmations, account alerts)',
          'To respond to support requests and resolve disputes',
          'To comply with legal, regulatory, and law enforcement obligations',
          'To improve the platform through anonymised analytics and usage data',
        ].map((item, i) => (
          <li key={i} style={{ marginBottom: '6px' }}>{item}</li>
        ))}
      </ul>
    ),
  },
  {
    heading: 'Legal Basis for Processing',
    content: (
      <>
        <p>
          We process your personal data on the following legal bases:
        </p>
        <ul style={{ paddingLeft: '20px', margin: '10px 0 0' }}>
          <li style={{ marginBottom: '6px' }}><strong>Contract performance:</strong> Processing necessary to provide the payment services you have requested</li>
          <li style={{ marginBottom: '6px' }}><strong>Legal obligation:</strong> KYC, AML, sanctions screening, and regulatory reporting requirements</li>
          <li style={{ marginBottom: '6px' }}><strong>Legitimate interests:</strong> Fraud prevention, platform security, and service improvement</li>
          <li style={{ marginBottom: '6px' }}><strong>Consent:</strong> Marketing communications (where applicable and where you have opted in)</li>
        </ul>
      </>
    ),
  },
  {
    heading: 'Information Sharing',
    content: (
      <>
        <p>We do not sell your personal information. We share data only in the following circumstances:</p>
        <ul style={{ paddingLeft: '20px', margin: '10px 0 0' }}>
          <li style={{ marginBottom: '6px' }}><strong>Between platform parties:</strong> Enterprise employers see the Stellar addresses and payment status of Workers they pay. Workers see the name and email of the Enterprise that paid them on their payslip.</li>
          <li style={{ marginBottom: '6px' }}><strong>Service providers:</strong> Cloud hosting providers, KYC/identity verification partners, and fraud detection services — all bound by data processing agreements.</li>
          <li style={{ marginBottom: '6px' }}><strong>Law enforcement and regulators:</strong> When required by court order, subpoena, or applicable law, or to protect the safety of persons or the integrity of the platform.</li>
          <li style={{ marginBottom: '6px' }}><strong>Business transfers:</strong> In the event of a merger, acquisition, or asset sale, your information may transfer to the acquiring entity subject to equivalent privacy protections.</li>
        </ul>
      </>
    ),
  },
  {
    heading: 'Blockchain and Public Ledger',
    content: (
      <p>
        Payments processed through Funti3rPay are settled on the Stellar public blockchain. Transaction data —
        including wallet addresses, payment amounts, asset types, and transaction hashes — is permanently recorded on
        the public ledger and accessible to anyone in the world. This data cannot be deleted or modified. By using our
        Service, you acknowledge and accept this inherent characteristic of public blockchain technology. We recommend
        treating your Stellar wallet address as pseudonymous but not anonymous.
      </p>
    ),
  },
  {
    heading: 'Data Retention',
    content: (
      <p>
        We retain personal data for as long as your account is active and for a minimum of 7 years after account
        closure to comply with financial recordkeeping requirements under applicable AML laws. KYC documents are
        retained for 5 years after the end of the business relationship. You may request deletion of non-mandatory
        data at any time; however, we may be unable to delete data we are required to retain by law.
      </p>
    ),
  },
  {
    heading: 'International Data Transfers',
    content: (
      <p>
        Funti3rPay operates across multiple African jurisdictions and may transfer your personal data to countries
        outside your country of residence, including countries that may have different data protection standards. Where
        required, we implement appropriate safeguards such as Standard Contractual Clauses (SCCs), Binding Corporate
        Rules, or rely on adequacy decisions. By using the Service, you consent to international transfers carried out
        in accordance with this Policy.
      </p>
    ),
  },
  {
    heading: 'Your Rights',
    content: (
      <>
        <p>Depending on your jurisdiction, you may have the following rights regarding your personal data:</p>
        <ul style={{ paddingLeft: '20px', margin: '10px 0 0' }}>
          {[
            'Right to access: request a copy of the personal data we hold about you',
            'Right to rectification: request correction of inaccurate or incomplete data',
            'Right to erasure: request deletion of your data (subject to legal retention requirements)',
            'Right to restrict processing: request that we limit how we use your data',
            'Right to data portability: receive your data in a machine-readable format',
            'Right to object: object to processing based on legitimate interests',
            'Right to withdraw consent: at any time, where processing is based on consent',
            'Right to lodge a complaint: with your national data protection authority',
          ].map((item, i) => (
            <li key={i} style={{ marginBottom: '6px' }}>{item}</li>
          ))}
        </ul>
        <p style={{ marginTop: '12px' }}>
          To exercise any of these rights, contact us at{' '}
          <a href="mailto:privacy@funti3rpay.com" style={{ color: '#374151' }}>privacy@funti3rpay.com</a>.
          We will respond within 30 days.
        </p>
      </>
    ),
  },
  {
    heading: 'Security',
    content: (
      <p>
        We implement industry-standard security measures including passkey-based (WebAuthn) authentication,
        AES-256 encryption for sensitive data at rest, TLS 1.3 for data in transit, and regular security audits.
        We conduct penetration testing and maintain an incident response plan. However, no method of electronic
        transmission or storage is 100% secure, and we cannot guarantee absolute security. In the event of a data
        breach that affects your rights, we will notify you and relevant authorities as required by law.
      </p>
    ),
  },
  {
    heading: "Children's Privacy",
    content: (
      <p>
        The Funti3rPay platform is not directed at individuals under the age of 18. We do not knowingly collect
        personal information from children. If you believe we have inadvertently collected such information, please
        contact us immediately and we will delete it promptly.
      </p>
    ),
  },
  {
    heading: 'Cookies and Tracking',
    content: (
      <p>
        We use session cookies and localStorage to maintain your authenticated session and user preferences. We do not
        use third-party advertising cookies or cross-site tracking. You may clear your browser cookies at any time;
        however, this will log you out of your session. We do not currently use analytics cookies from third parties
        such as Google Analytics.
      </p>
    ),
  },
  {
    heading: 'Changes to This Policy',
    content: (
      <p>
        We may update this Privacy Policy to reflect changes in our practices or applicable law. We will notify you of
        material changes by email or by a prominent notice on the platform at least 14 days before the change takes
        effect. The "Last updated" date at the top of this page indicates when the Policy was last revised.
      </p>
    ),
  },
];

export default function Privacy() {
  return (
    <LegalLayout
      title="Privacy Policy"
      updated={UPDATED}
      intro="Your privacy is fundamental to how we operate. This Privacy Policy describes how Funti3r Technologies collects, uses, stores, and protects your personal information in connection with the Funti3rPay cross-border payroll platform."
      sections={sections}
    />
  );
}
