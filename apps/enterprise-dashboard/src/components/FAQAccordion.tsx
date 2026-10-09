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
    <div>
      {items.map((item, index) => {
        const open = openIndex === index;
        return (
          <div key={index} style={{ borderTop: index === 0 ? 'none' : '1px solid var(--gray-200)' }}>
            <button
              onClick={() => setOpenIndex(open ? null : index)}
              aria-expanded={open}
              style={{
                width: '100%',
                padding: '14px 0',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '16px',
                fontSize: '0.9rem',
                fontWeight: 600,
                color: 'var(--gray-900)',
                textAlign: 'left',
                fontFamily: 'inherit',
              }}
            >
              {item.question}
              <HiChevronDown
                size={18}
                style={{
                  flexShrink: 0,
                  color: 'var(--gray-600)',
                  transition: 'transform 0.2s',
                  transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
              />
            </button>
            {open && (
              <p style={{ fontSize: '0.86rem', color: 'var(--gray-600)', lineHeight: 1.6, margin: '0 0 14px' }}>
                {item.answer}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
