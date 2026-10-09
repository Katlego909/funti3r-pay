import { useEffect, useId, useRef, useState } from 'react';
import { COUNTRY_MAP, filterCountries } from '../lib/countries.js';

interface Props {
  /** ISO country code, or '' for none. */
  value: string;
  onChange: (code: string) => void;
  placeholder: string;
}

const inputStyle = {
  width: '100%',
  padding: '8px',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  boxSizing: 'border-box',
} as const;

/** A country picker you can type into: matches by name or code, African countries first. */
export function CountrySelect({ value, onChange, placeholder }: Props) {
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);

  // While the list is closed the box shows the chosen country; while open it shows what is being typed.
  const shown = open ? text : value ? COUNTRY_MAP[value] ?? value : '';
  const matches = filterCountries(open ? text : '');

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (code: string) => {
    onChange(code);
    setOpen(false);
    setText('');
  };

  const openList = () => {
    if (open) return;
    setText('');
    setActive(Math.max(0, filterCountries('').indexOf(value)));
    setOpen(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) return openList();
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (matches[active]) choose(matches[active]);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={root} style={{ position: 'relative' }}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={shown}
        placeholder={placeholder}
        onFocus={openList}
        onClick={openList}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        style={inputStyle}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          style={{
            position: 'absolute', zIndex: 20, top: 'calc(100% + 4px)', left: 0, right: 0,
            maxHeight: 260, overflowY: 'auto', margin: 0, padding: 4, listStyle: 'none',
            background: 'white', border: '1px solid #d1d5db', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
          }}
        >
          {matches.length === 0 && (
            <li style={{ padding: '8px 10px', color: 'var(--gray-600)', fontSize: '0.88rem' }}>No country found</li>
          )}
          {matches.map((code, i) => (
            <li
              key={code}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); choose(code); }}
              onMouseEnter={() => setActive(i)}
              style={{
                padding: '8px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '0.9rem',
                background: i === active ? 'var(--gray-100)' : 'transparent',
                fontWeight: code === value ? 600 : 400,
              }}
            >
              {COUNTRY_MAP[code]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
