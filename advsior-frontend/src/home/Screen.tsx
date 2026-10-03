import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, EmptyState, Icon, ScreenState, packetStatus, timeAgo, useCaseActivity, useCaseChecklist, useCaseDocuments, useCasePackets, useRelay } from '@relay/shared';
import './Screen.css';

type Filter = 'all' | 'attention' | 'review';

const actorLabels: Record<string, string> = { agent: 'Relay', founder: 'Founder', advisor: 'You', system: 'System' };

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('');
}

export default function Screen() {
  const { snapshot, role } = useRelay();
  const { packets } = useCasePackets();
  const { documents } = useCaseDocuments();
  const checklist = useCaseChecklist();
  const activity = useCaseActivity(undefined, 6);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  if (!snapshot || role !== 'advisor') return <ScreenState>{null}</ScreenState>;

  const latest = packets?.[0] ?? null;
  const items = checklist.items ?? [];
  const done = items.filter(item => item.state === 'done').length;
  const progress = items.length ? Math.round(done / items.length * 100) : 0;
  const fileCount = (packets?.length ?? 0) + (documents?.length ?? 0);
  const hasClient = fileCount > 0;
  // A packet waiting on the advisor: in review with no decision yet.
  const needsReview = Boolean(latest && latest.status === 'in_review' && !latest.review_decision);
  const visible = hasClient
    && (snapshot.company + ' ' + snapshot.founder.name).toLowerCase().includes(query.trim().toLowerCase())
    && (filter === 'all' || needsReview);
  const stage = latest ? packetStatus(latest) : { label: 'Gathering documents', tone: 'neutral' as const };
  const clientLink = latest ? `/advisor/clients?version=${encodeURIComponent(latest.id)}` : '/advisor/clients';

  return <ScreenState><div className="advisor-home">
    <header className="advisor-home-intro">
      <h1>Hi, {snapshot.advisors[0]?.name.split(' ')[0] ?? 'advisor'}</h1>
      <p>Here’s where your clients stand.</p>
      <div className="advisor-home-summary">{hasClient ? '1 assigned client' : 'No assigned clients'}<span aria-hidden="true"> · </span>{needsReview ? '1 packet ready for your review' : 'Nothing waiting for review'}</div>
    </header>

    <section className="advisor-home-section" aria-labelledby="advisor-home-clients-title">
      <h2 id="advisor-home-clients-title">Your clients</h2>
      <div className="advisor-home-toolbar">
        <label className="advisor-home-search"><span className="sr-only">Search assigned clients</span><Icon name="search" size={18}/><input value={query} onChange={event => setQuery(event.currentTarget.value)} placeholder="Search clients..."/></label>
        <div className="advisor-home-filters" role="group" aria-label="Filter clients">
          <button type="button" className={filter === 'all' ? 'is-active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All clients</button>
          <button type="button" className={filter === 'attention' ? 'is-active' : ''} aria-pressed={filter === 'attention'} onClick={() => setFilter('attention')}>Needs attention</button>
          <button type="button" className={filter === 'review' ? 'is-active' : ''} aria-pressed={filter === 'review'} onClick={() => setFilter('review')}>Ready for review</button>
        </div>
      </div>
      {packets === null || documents === null
        ? <p className="advisor-home-all-clear" role="status">Loading clients…</p>
        : !hasClient
        ? <EmptyState title="No assigned clients"><p>A client appears here once they upload documents or a packet is prepared.</p></EmptyState>
        : !visible
          ? <EmptyState title="No matching clients"><p>Try another search or filter.</p></EmptyState>
          : <div className="advisor-home-table-wrap">
            <table className="advisor-home-table"><thead><tr><th scope="col">Client</th><th scope="col">Progress <span className="advisor-home-progress-help">Checklist items done</span></th><th scope="col">Stage</th><th scope="col">Documents</th><th scope="col">Next step</th></tr></thead>
              <tbody><tr><td><div className="advisor-home-client"><span className="advisor-home-initials">{initials(snapshot.founder.name)}</span><span><strong>{snapshot.founder.name}</strong><small>{snapshot.company}</small></span></div></td>
                <td><div className="advisor-home-progress"><div className="advisor-home-progress-track" role="progressbar" aria-label={snapshot.company + ' checklist progress'} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: progress + '%' }}/></div><strong>{progress}%</strong><small>{done} of {items.length} done</small></div></td>
                <td><Badge tone={stage.tone}>{latest ? `v${latest.version} · ${stage.label}` : stage.label}</Badge></td>
                <td>{fileCount} file{fileCount === 1 ? '' : 's'}</td>
                <td><Link className={'button ' + (needsReview ? 'button-primary' : 'button-outline')} to={clientLink}>{needsReview ? 'Review packet' : 'View client'}</Link></td>
              </tr></tbody>
            </table>
          </div>}
    </section>

    <section className="advisor-home-section advisor-home-attention" aria-labelledby="advisor-home-attention-title">
      <h2 id="advisor-home-attention-title">Needs your attention</h2>
      <p>Packets waiting for your review.</p>
      {needsReview && latest
        ? <div className="advisor-home-attention-row">
            <div className="advisor-home-client"><span className="advisor-home-initials">{initials(snapshot.founder.name)}</span><span><strong>{snapshot.company}</strong><small>{snapshot.founder.name}</small></span></div>
            <span>Packet v{latest.version} ready for review{latest.change_note ? ` — ${latest.change_note}` : ''}</span>
            <time dateTime={latest.created_at}>{new Date(latest.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</time>
            <Link className="button button-primary" to={clientLink}>Review packet</Link>
          </div>
        : <p className="advisor-home-all-clear">No packet is waiting for your review.</p>}
    </section>

    <section className="advisor-home-section" aria-labelledby="advisor-home-activity-title">
      <h2 id="advisor-home-activity-title">Recent activity</h2>
      <p>What changed in {snapshot.company}’s case.</p>
      {activity.error ? <p className="advisor-home-all-clear" role="alert">{activity.error}</p>
        : activity.entries === null ? <p className="advisor-home-all-clear" role="status">Loading activity…</p>
        : activity.entries.length === 0 ? <p className="advisor-home-all-clear">No activity yet.</p>
        : <ul className="advisor-home-activity">{activity.entries.map(entry => <li key={entry.id}>
            <strong>{actorLabels[entry.actor] ?? entry.actor}</strong><span>{entry.text}</span><small>{timeAgo(entry.created_at)}</small>
          </li>)}</ul>}
      <div className="advisor-home-links"><Link className="button button-outline" to="/advisor/clients">Open client documents</Link><Link className="button button-outline" to="/advisor/messages">Messages</Link></div>
    </section>
  </div></ScreenState>;
}
