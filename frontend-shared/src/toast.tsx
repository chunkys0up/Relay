import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import './toast.css';

// Small confirmations after an action is saved, in the same dark style as the incoming-call notice.

type Tone = 'success' | 'error';
interface Toast { id: number; message: string; tone: Tone }
const TOAST_EVENT = 'relay:toast';
const VISIBLE_MS = 3200;
let nextId = 1;

/** Show a short confirmation, e.g. toast('Summary saved'). */
export function toast(message: string, tone: Tone = 'success'): void {
  window.dispatchEvent(new CustomEvent<Toast>(TOAST_EVENT, { detail: { id: nextId++, message, tone } }));
}

export function Toaster(): ReactNode {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    const add = (event: Event): void => {
      const item = (event as CustomEvent<Toast>).detail;
      setToasts(current => [...current.slice(-2), item]);
      window.setTimeout(() => setToasts(current => current.filter(t => t.id !== item.id)), VISIBLE_MS);
    };
    window.addEventListener(TOAST_EVENT, add);
    return () => window.removeEventListener(TOAST_EVENT, add);
  }, []);
  return <div className="toaster" role="status" aria-live="polite">
    {toasts.map(item => <div key={item.id} className={`toast is-${item.tone}`}>
      <span className="toast-icon" aria-hidden="true">{item.tone === 'success' ? '✓' : '!'}</span>
      <span>{item.message}</span>
      <button type="button" aria-label="Dismiss" onClick={() => setToasts(current => current.filter(t => t.id !== item.id))}>×</button>
    </div>)}
  </div>;
}
