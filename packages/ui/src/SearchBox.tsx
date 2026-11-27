import { ReactNode, useEffect, useRef, useState } from 'react';
import { HiOutlineCommandLine, HiOutlineMagnifyingGlass, HiOutlineXMark } from 'react-icons/hi2';

interface SearchBoxProps {
  placeholder: string;
  /** Called with the query once typing pauses (and with '' when cleared). */
  onQuery: (query: string) => void;
  /** Enter in the box; the dropdown closes. */
  onSubmit?: (query: string) => void;
  /** The dropdown's results for the current query; `close` resets the box after a result is chosen. */
  children: (ctx: { query: string; close: () => void }) => ReactNode;
}

const DEBOUNCE_MS = 280;

/**
 * The top bar's search box, shared by every app: ⌘K / Ctrl+K focuses it, Escape and a click outside close it, and the
 * dropdown shows whatever results the app renders for the query.
 */
export default function SearchBox({ placeholder, onQuery, onSubmit, children }: SearchBoxProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onQueryRef = useRef(onQuery);
  onQueryRef.current = onQuery;

  useEffect(() => {
    const t = setTimeout(() => onQueryRef.current(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, []);

  const close = () => { setOpen(false); setQuery(''); };

  return (
    <div className="global-search" ref={containerRef}>
      <form
        className={`gs-input-wrap ${open ? 'focused' : ''}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (onSubmit && query.trim()) { onSubmit(query.trim()); setOpen(false); inputRef.current?.blur(); }
        }}
      >
        <HiOutlineMagnifyingGlass size={15} className="gs-icon" />
        <input
          ref={inputRef}
          className="gs-input"
          placeholder={placeholder}
          aria-label={placeholder}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
          spellCheck={false}
        />
        {query ? (
          <button type="button" className="gs-clear" onClick={() => { setQuery(''); inputRef.current?.focus(); }} aria-label="Clear search">
            <HiOutlineXMark size={13} />
          </button>
        ) : (
          <kbd className="gs-kbd">⌘K</kbd>
        )}
      </form>

      {open && query.trim().length > 0 && (
        <div className="gs-dropdown">
          {children({ query: query.trim(), close })}
          <div className="gs-footer">
            <HiOutlineCommandLine size={11} /> {onSubmit ? 'Enter for all results · ' : ''}Esc to close
          </div>
        </div>
      )}
    </div>
  );
}
