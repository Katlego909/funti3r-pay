import { useState } from 'react';
import { HiChevronDown } from 'react-icons/hi2';

interface FAQItem {
  question: string;
  answer: string;
}

interface FAQAccordionProps {
  items: FAQItem[];
}

export function FAQAccordion({ items }: FAQAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      {items.map((item, index) => (
        <div
          key={index}
          style={{
            margin: 0,
            border: '1px solid #e5e7eb',
            borderRadius: '12px',
            overflow: 'hidden',
            transition: 'all 0.3s',
            background: 'white',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#3b82f6';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#e5e7eb';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <button
            onClick={() => setOpenIndex(openIndex === index ? null : index)}
            style={{
              width: '100%',
              padding: '20px 24px',
              background: openIndex === index ? '#f9fafb' : 'white',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '16px',
              fontSize: '16px',
              fontWeight: 600,
              color: openIndex === index ? '#3b82f6' : '#111827',
              transition: 'all 0.3s',
              textAlign: 'left',
              fontFamily: "'Archivo Black', sans-serif",
            }}
          >
            {item.question}
            <HiChevronDown
              size={24}
              style={{
                flexShrink: 0,
                color: '#3b82f6',
                transition: 'transform 0.3s',
                transform: openIndex === index ? 'rotate(180deg)' : 'rotate(0deg)',
              }}
            />
          </button>

          {openIndex === index && (
            <div
              style={{
                padding: '0 24px 20px 24px',
                background: 'white',
                borderTop: '1px solid #e5e7eb',
                animation: 'slideDown 0.3s ease-out',
              }}
            >
              <p
                style={{
                  fontSize: '15px',
                  color: '#6b7280',
                  lineHeight: '1.6',
                  margin: 0,
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                {item.answer}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
