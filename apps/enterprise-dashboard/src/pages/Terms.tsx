import LegalLayout from '../components/LegalLayout.js';

const UPDATED = 'July 2, 2026';

const sections = [
  {
    heading: 'Acceptance of Terms',
    content: (
      <p>
        By accessing or using the Funti3rPay platform ("Service"), you agree to be bound by these Terms of Service
        ("Terms"). If you are using the Service on behalf of an organisation, you represent that you have authority to
        bind that organisation to these Terms. If you do not agree to these Terms, do not use the Service.
      </p>
    ),
  },
  {
    heading: 'Description of Services',
    content: (
      <>
        <p>
          Funti3rPay is a cross-border payroll and payment facilitation platform that enables registered businesses
          ("Enterprises") to pay remote workers ("Workers") in their local African currencies. Payments are settled on
          the Stellar public blockchain network using path payments and decentralised exchange routing.
        </p>
        <p style={{ marginTop: '10px' }}>
          We provide infrastructure for payment processing, wallet management, KYC verification, and payroll scheduling.
          We are not a bank, money services business, or licensed financial institution in all jurisdictions. Our
          services are subject to applicable payment laws in each country of operation.
        </p>
      </>
    ),
  },
  {
    heading: 'Eligibility',
    content: (
      <p>
        You must be at least 18 years of age to use the Service. Enterprise accounts must be registered to a validly
        incorporated legal entity. Workers must provide accurate identity information and reside in a jurisdiction we
        support. We reserve the right to refuse service to anyone for any reason at any time, including for regulatory
        compliance purposes.
      </p>
    ),
  },
  {
    heading: 'Account Registration and Security',
    content: (
      <>
        <p>
          You must register using passkey-based authentication (WebAuthn). You are responsible for maintaining the
          security of your registered devices and authentication credentials. You must notify us immediately at{' '}
          <a href="mailto:security@funti3rpay.com" style={{ color: '#374151' }}>security@funti3rpay.com</a> if you
          suspect unauthorised access to your account.
        </p>
        <p style={{ marginTop: '10px' }}>
          You agree to provide accurate, current, and complete information during registration and to keep this
          information updated. False or misleading registration information may result in immediate account termination
          and referral to relevant authorities.
        </p>
      </>
    ),
  },
  {
    heading: 'Enterprise Obligations',
    content: (
      <p>
        Enterprises are solely responsible for ensuring that the payroll amounts they submit are accurate, legally owed
        to Workers, and compliant with applicable labour and tax laws in the Workers' jurisdictions. Funti3rPay does not
        verify employment relationships or payroll entitlements. Enterprises must not use the Service to make payments
        for illegal purposes, to sanctioned persons or entities, or in violation of any applicable law.
      </p>
    ),
  },
  {
    heading: 'Worker Obligations',
    content: (
      <p>
        Workers must complete identity verification (KYC) as required and provide a valid Stellar wallet address for
        receiving payments. Workers are responsible for declaring income received through the platform in accordance with
        the tax laws of their country of residence. Workers must not misrepresent their identity, location, or
        eligibility during the onboarding process.
      </p>
    ),
  },
  {
    heading: 'Payment Processing',
    content: (
      <>
        <p>
          Payments are processed in USD and converted to the Worker's preferred local currency (NGN, KES, GHS, ZAR,
          UGX, or others) via Stellar DEX path payments at the prevailing market exchange rate. Exchange rates are
          determined by Stellar network liquidity at the time of settlement and may differ from published mid-market
          rates. Funti3rPay does not guarantee any specific exchange rate.
        </p>
        <p style={{ marginTop: '10px' }}>
          Once a payment is submitted to the Stellar network it is irreversible. It is the Enterprise's responsibility
          to verify recipient details before authorising payment. Funti3rPay will make reasonable efforts to recover
          funds sent in error but cannot guarantee recovery.
        </p>
      </>
    ),
  },
  {
    heading: 'Fees and Pricing',
    content: (
      <p>
        Applicable fees are disclosed at the time of payment. Fees may include a platform service fee and Stellar
        network transaction fees (paid in XLM). All fees are non-refundable unless we are responsible for a platform
        error. We reserve the right to change our fee structure with 30 days' notice published on this website or
        delivered to the registered email address of your account.
      </p>
    ),
  },
  {
    heading: 'Prohibited Conduct',
    content: (
      <ul style={{ paddingLeft: '20px', margin: 0 }}>
        {[
          'Making payments to or from sanctioned individuals, entities, or jurisdictions',
          'Using the platform to launder money, finance terrorism, or evade taxes',
          'Providing false or misleading identity or business information',
          'Circumventing KYC/AML controls or transaction limits',
          'Reverse engineering, scraping, or disrupting the Service',
          'Using automated systems to access the Service without written permission',
          'Misrepresenting your relationship with Funti3rPay to third parties',
        ].map((item, i) => (
          <li key={i} style={{ marginBottom: '6px' }}>{item}</li>
        ))}
      </ul>
    ),
  },
  {
    heading: 'Blockchain Transparency Notice',
    content: (
      <p>
        All transactions settled on the Stellar network are permanently recorded on a public blockchain. Payment
        amounts, wallet addresses, and transaction hashes are publicly visible on the Stellar ledger. By using the
        Service, you acknowledge and accept that on-chain transaction data is publicly accessible and cannot be deleted
        or modified after settlement.
      </p>
    ),
  },
  {
    heading: 'Intellectual Property',
    content: (
      <p>
        All content, branding, and software constituting the Funti3rPay platform is owned by Funti3r Technologies and
        its licensors. You are granted a limited, non-exclusive, non-transferable licence to use the Service for its
        intended purpose. Nothing in these Terms transfers any intellectual property rights to you.
      </p>
    ),
  },
  {
    heading: 'Disclaimer of Warranties',
    content: (
      <p>
        The Service is provided "as is" and "as available" without warranties of any kind, express or implied, including
        but not limited to merchantability, fitness for a particular purpose, and non-infringement. We do not warrant
        that the Service will be uninterrupted, error-free, or free from security vulnerabilities. Blockchain networks
        are decentralised and we have no control over their uptime or performance.
      </p>
    ),
  },
  {
    heading: 'Limitation of Liability',
    content: (
      <p>
        To the maximum extent permitted by applicable law, Funti3r Technologies shall not be liable for any indirect,
        incidental, special, consequential, or punitive damages, including loss of profits, data, or goodwill, arising
        from your use of or inability to use the Service. Our aggregate liability for any claim relating to the Service
        shall not exceed the total fees you paid to us in the three months preceding the claim.
      </p>
    ),
  },
  {
    heading: 'Indemnification',
    content: (
      <p>
        You agree to indemnify, defend, and hold harmless Funti3r Technologies and its officers, directors, employees,
        and agents from any claim, liability, damage, or expense (including reasonable legal fees) arising from your
        use of the Service, your violation of these Terms, or your violation of any law or third-party rights.
      </p>
    ),
  },
  {
    heading: 'Termination',
    content: (
      <p>
        We may suspend or terminate your access to the Service at any time without notice if we believe you have
        violated these Terms, if required by law or regulation, or to protect the integrity of the platform. Upon
        termination, your right to use the Service ceases immediately. Provisions of these Terms that by their nature
        should survive termination shall do so, including intellectual property, limitation of liability, and
        indemnification.
      </p>
    ),
  },
  {
    heading: 'Governing Law and Dispute Resolution',
    content: (
      <p>
        These Terms are governed by the laws of the Republic of South Africa. Any dispute arising under these Terms
        shall first be subject to good-faith negotiation. If unresolved within 30 days, disputes shall be referred to
        binding arbitration in Johannesburg under the rules of the Arbitration Foundation of Southern Africa (AFSA).
        Nothing in this clause prevents either party from seeking urgent interim relief from a court of competent
        jurisdiction.
      </p>
    ),
  },
  {
    heading: 'Changes to These Terms',
    content: (
      <p>
        We may update these Terms from time to time. We will notify you of material changes by email or by displaying a
        prominent notice on the platform at least 14 days before the changes take effect. Your continued use of the
        Service after the effective date of revised Terms constitutes acceptance of those changes.
      </p>
    ),
  },
];

export default function Terms() {
  return (
    <LegalLayout
      title="Terms of Service"
      updated={UPDATED}
      intro="Please read these Terms of Service carefully before using the Funti3rPay platform. These Terms form a legally binding agreement between you and Funti3r Technologies governing your access to and use of our cross-border payroll and payment services."
      sections={sections}
    />
  );
}
