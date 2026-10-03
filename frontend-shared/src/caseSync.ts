import { useEffect } from 'react';
import { announceCaseUpdate, caseVersion, LIVE_CASE_ID } from './relayApi';

const POLL_MS = 4000;

/**
 * Keeps every screen current with changes made elsewhere (the other person, or Relay in another tab):
 * polls the case's last-change time and announces a case update only when it moves.
 */
export function useCaseSync(caseId: string = LIVE_CASE_ID): void {
  useEffect(() => {
    let last: string | null | undefined;
    let controller: AbortController | null = null;
    const check = (): void => {
      if (document.visibilityState !== 'visible') return;
      controller?.abort();
      controller = new AbortController();
      caseVersion(caseId, controller.signal).then(version => {
        if (last !== undefined && version !== last) announceCaseUpdate();
        last = version;
      }).catch(() => { /* try again on the next tick */ });
    };
    check();
    const timer = window.setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', check);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', check); controller?.abort(); };
  }, [caseId]);
}
