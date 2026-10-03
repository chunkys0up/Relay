import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useRelay } from './context';
import { plainText, timeAgo, useCaseChecklist, useCaseDocuments, useRecentMessages } from './live';
import { packetStatus, useCasePackets } from './packets';
import { Badge, Button, EmptyState, Icon, PageTitle, Panel } from './ui';

type Kind = 'files' | 'packets' | 'checklist' | 'messages';
interface Result { id: string; kind: Kind; title: string; detail: string; badge: string; to: string }

const filters: { id: 'all' | Kind; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'files', label: 'Files' }, { id: 'packets', label: 'Packets' },
  { id: 'checklist', label: 'Checklist' }, { id: 'messages', label: 'Messages' },
];
const groupTitles: Record<Kind, string> = { files: 'Files', packets: 'Packet versions', checklist: 'Checklist', messages: 'Messages' };

/** Searches the case's real files, packet versions, checklist and recent messages. */
export default function Search(): ReactNode {
  const { snapshot, role } = useRelay();
  const [params, setParams] = useSearchParams();
  const { documents } = useCaseDocuments();
  const { packets } = useCasePackets();
  const { items } = useCaseChecklist();
  const messages = useRecentMessages(role, 50);
  const query = params.get('q') ?? '';
  const filter = (params.get('filter') ?? 'all') as 'all' | Kind;
  const term = query.trim().toLowerCase();
  if (!snapshot) return null;

  const other = role === 'founder' ? snapshot.advisors[0]?.name : snapshot.founder.name;
  const results: Result[] = [
    ...(documents ?? []).map((doc): Result => ({
      id: doc.id, kind: 'files', title: doc.filename, detail: `Uploaded ${timeAgo(doc.uploaded_at)}`, badge: 'File',
      to: role === 'founder' ? '/founder/home' : `/advisor/clients?source=${encodeURIComponent(doc.id)}`,
    })),
    ...(packets ?? []).map((packet): Result => ({
      id: packet.id, kind: 'packets', title: `Planning packet v${packet.version}`,
      detail: packet.change_note ?? `Created ${timeAgo(packet.created_at)}`, badge: packetStatus(packet).label,
      to: role === 'founder' ? '/founder/call' : `/advisor/clients?version=${encodeURIComponent(packet.id)}`,
    })),
    ...(items ?? []).map((item): Result => ({
      id: item.id, kind: 'checklist', title: item.title, detail: item.detail ?? '', badge: item.state.replace('_', ' '),
      to: role === 'founder' ? '/founder/home' : '/advisor/home',
    })),
    ...(messages ?? []).map((message): Result => {
      const fromAi = message.sender_type === 'ai';
      const author = fromAi ? 'Relay' : message.sender_type === role ? 'You' : other ?? 'Them';
      return {
        id: message.id, kind: 'messages', title: `${author} · ${timeAgo(message.created_at)}`, detail: plainText(message.content), badge: fromAi ? 'AI chat' : 'Message',
        to: role === 'founder' ? '/founder/chat' : fromAi ? '/advisor/clients' : '/advisor/messages',
      };
    }),
  ];
  const matches = results.filter(result => !term || `${result.title} ${result.detail} ${result.badge}`.toLowerCase().includes(term));
  const shown = matches.filter(result => filter === 'all' || result.kind === filter);
  const loading = documents === null || packets === null || items === null || messages === null;
  const update = (key: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  return <section className="utility-page">
    <PageTitle title="Search" subtitle={`Find files, packet versions, checklist items and messages in ${snapshot.company}'s case.`}/>
    <Panel>
      <label htmlFor="workspace-query">Search the case</label>
      <div className="utility-search"><Icon name="search" size={18}/><input id="workspace-query" type="search" value={query} onChange={event => update('q', event.target.value)} placeholder="Search by name, note or message"/>{query && <Button variant="subtle" onClick={() => update('q', '')}>Clear search</Button>}</div>
      <div className="search-filters" aria-label="Result types">{filters.map(item => {
        const count = item.id === 'all' ? matches.length : matches.filter(result => result.kind === item.id).length;
        return <Button key={item.id} variant={filter === item.id ? 'primary' : 'outline'} aria-pressed={filter === item.id} onClick={() => update('filter', item.id === 'all' ? '' : item.id)}>{item.label} ({count})</Button>;
      })}</div>
      <p role="status" className="muted">{loading ? 'Searching…' : `${shown.length} result${shown.length === 1 ? '' : 's'}${term ? ` for “${query}”` : ''}`}</p>
    </Panel>
    {!loading && shown.length === 0
      ? <Panel><EmptyState title="No matching results"><p>Try a file name, a packet note, or a word from a message.</p><Button variant="outline" onClick={() => setParams({})}>Show everything</Button></EmptyState></Panel>
      : (Object.keys(groupTitles) as Kind[]).map(kind => {
          const group = shown.filter(result => result.kind === kind);
          return group.length > 0 && <Panel key={kind} title={groupTitles[kind]}><div className="search-results">{group.map(result => <article key={result.id}>
            <Icon name={kind === 'messages' ? 'message' : 'file'} size={27}/>
            <div><h3>{result.title}</h3>{result.detail && <p>{result.detail.slice(0, 160)}</p>}<Badge>{result.badge}</Badge></div>
            <Link className="button button-outline" aria-label={`Open ${result.title}`} to={result.to}>Open</Link>
          </article>)}</div></Panel>;
        })}
  </section>;
}
