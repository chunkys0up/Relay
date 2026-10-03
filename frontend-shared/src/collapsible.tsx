import { useState } from 'react';
import type { ReactNode } from 'react';

function readOpen(key: string): boolean {
  try { return localStorage.getItem(key) !== 'closed'; } catch { return true; }
}

/** A heading that shows or hides the content below it; the choice is remembered per section. */
export function Collapsible({ id, title, headingId, as: Heading = 'h2', children }: {
  id: string; title: ReactNode; headingId?: string; as?: 'h2' | 'h3'; children: ReactNode;
}): ReactNode {
  const key = `relay-section:${id}`;
  const [open, setOpen] = useState(() => readOpen(key));
  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(key, next ? 'open' : 'closed'); } catch { /* remembered for this visit only */ }
  };
  return <>
    <Heading id={headingId} className="collapsible-heading">
      <button type="button" aria-expanded={open} aria-controls={`${id}-body`} onClick={toggle}>
        <span>{title}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </button>
    </Heading>
    <div id={`${id}-body`} className="collapsible-body" hidden={!open}>{children}</div>
  </>;
}
