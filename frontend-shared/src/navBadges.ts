import { useEffect, useState } from 'react';
import { useCaseDocuments, useRecentMessages } from './live';
import { useCasePackets } from './packets';
import type { Role } from './types';

// Which nav sections have something new since you last opened them. "Last seen" is per role and per
// section, kept in this browser. A section counts as seen while you're on it.

type Stamp = string | null | undefined;
const latest = (...stamps: Stamp[]): string | null =>
  stamps.reduce<string | null>((max, stamp) => (stamp && (!max || stamp > max) ? stamp : max), null);

const seenKey = (role: Role, section: string): string => `relay-seen:${role}:${section}`;
function readSeen(role: Role, section: string): string | null {
  try { return localStorage.getItem(seenKey(role, section)); } catch { return null; }
}
function writeSeen(role: Role, section: string, value: string): void {
  try { localStorage.setItem(seenKey(role, section), value); } catch { /* remembered for this visit only */ }
}

/** Nav paths (e.g. "chat", "messages") that should show a "new" dot. */
export function useNavBadges(role: Role, pathname: string): Set<string> {
  const messages = useRecentMessages(role, 20);
  const { packets } = useCasePackets();
  const { documents } = useCaseDocuments();
  const [, setTick] = useState(0);
  const other: Role = role === 'founder' ? 'advisor' : 'founder';

  // Newest thing in each section that the other side (or Relay) did.
  const fromOther = latest(...(messages ?? []).filter(m => m.sender_type === other).map(m => m.created_at));
  const packetNews = latest(
    ...(packets ?? []).map(p => p.created_at),
    ...(packets ?? []).map(p => (role === 'founder' && !p.review_resolved_at ? p.reviewed_at : null)),
    ...(packets ?? []).map(p => (role === 'advisor' ? p.review_resolved_at : null)),
  );
  const newest: Record<string, string | null> = role === 'founder'
    ? { chat: fromOther, call: packetNews }
    : { messages: fromOther, clients: latest(packetNews, ...(documents ?? []).map(d => d.uploaded_at)) };

  const current = pathname.split('/')[2] ?? '';
  const stamps = JSON.stringify(newest);
  const loaded = messages !== null && packets !== null && documents !== null;
  useEffect(() => {
    if (!loaded) return;
    let changed = false;
    for (const [section, stamp] of Object.entries(JSON.parse(stamps) as Record<string, string | null>)) {
      const seen = readSeen(role, section);
      // First visit: start from now so old activity doesn't light everything up.
      if (seen === null) { writeSeen(role, section, stamp ?? new Date(0).toISOString()); changed = true; }
      else if (section === current && stamp && stamp > seen) { writeSeen(role, section, stamp); changed = true; }
    }
    if (changed) setTick(tick => tick + 1);
  }, [stamps, role, current, loaded]);

  if (!loaded) return new Set();
  return new Set(Object.entries(newest)
    .filter(([section, stamp]) => section !== current && stamp && (readSeen(role, section) ?? stamp) < stamp)
    .map(([section]) => section));
}
