import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, EmptyState, Icon, ScreenState, useRelay } from '@relay/shared';
import type { CaseSnapshot, PacketVersion, Review } from '@relay/shared';
import './Screen.css';

type Filter = 'all' | 'attention' | 'review';

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('');
}

function latestSharedPacket(snapshot: CaseSnapshot): PacketVersion | null {
  const advisorId = snapshot.advisors[0]?.id;
  return snapshot.packets.filter(packet => snapshot.grants.some(grant =>
    grant.advisor_id === advisorId
    && grant.packet_version_id === packet.id
    && grant.packet_hash === packet.hash,
  )).sort((a, b) => b.version - a.version)[0] ?? null;
}

function latestReviewFor(snapshot: CaseSnapshot, packet: PacketVersion | null): Review | null {
  return packet ? snapshot.reviews.filter(review => review.packet_version_id === packet.id).sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1) ?? null : null;
}

export default function Screen() {
  const { snapshot, role } = useRelay();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  if (!snapshot || role !== 'advisor') return <ScreenState>{null}</ScreenState>;

  const advisorId = snapshot.advisors[0]?.id;
  const sharedSourceIds = new Set(snapshot.grants.filter(grant => grant.advisor_id === advisorId).flatMap(grant => grant.source_ids));
  const sharedSources = snapshot.sources.filter(source => sharedSourceIds.has(source.id));
  const sharedPackets = snapshot.packets.filter(packet => snapshot.grants.some(grant =>
    grant.advisor_id === advisorId && grant.packet_version_id === packet.id && grant.packet_hash === packet.hash,
  ));
  const packet = latestSharedPacket(snapshot);
  const review = latestReviewFor(snapshot, packet);
  const hasClient = sharedSources.length + sharedPackets.length > 0;
  const needsReview = Boolean(packet && packet.status !== 'approved' && review?.decision !== 'approved' && review?.decision !== 'questions_returned' && packet.status !== 'questions_returned');
  const questionsReturned = review?.decision === 'questions_returned' || packet?.status === 'questions_returned';
  const approved = review?.decision === 'approved' || packet?.status === 'approved';
  const responded = snapshot.reviews.some(item => item.decision === 'questions_returned' && sharedPackets.some(shared => shared.id === item.packet_version_id));
  const completed = Number(sharedSources.length > 0) + Number(sharedPackets.length > 0) + Number(responded || approved) + Number(approved);
  const progress = Math.round(completed / 4 * 100);
  const visible = hasClient
    && (snapshot.company + ' ' + snapshot.founder.name).toLowerCase().includes(query.trim().toLowerCase())
    && (filter === 'all' || needsReview);
  const stage = approved ? 'Approved' : questionsReturned ? 'Questions returned' : needsReview ? 'Advisor review' : snapshot.status;
  const action = approved ? 'View client' : questionsReturned ? 'View questions' : needsReview ? 'Review packet' : 'View client';
  const clientLink = packet ? `/advisor/clients?version=${encodeURIComponent(packet.id)}` : '/advisor/clients';
  const activityDate = review?.created_at ?? packet?.created_at ?? sharedSources.at(-1)?.created_at;
  const activityText = approved
    ? `Packet v${packet?.version} approved`
    : questionsReturned
      ? `Questions returned for packet v${packet?.version}`
      : packet
        ? `Packet v${packet.version} shared for review`
        : 'Sources shared';

  return <ScreenState><div className="advisor-home">
    <header className="advisor-home-intro">
      <h1>Hi, {snapshot.advisors[0]?.name.split(' ')[0] ?? 'advisor'}</h1>
      <p>Here’s where your clients stand.</p>
      <div className="advisor-home-summary">{hasClient ? '1 assigned client' : 'No assigned clients'}<span aria-hidden="true"> · </span>{needsReview ? '1 needs your attention' : '0 need your attention'}<span aria-hidden="true"> · </span>{needsReview ? '1 ready for review' : '0 ready for review'}</div>
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
      {!hasClient
        ? <EmptyState title="No assigned clients"><p>A founder’s confirmed handoff will appear here with its shared documents.</p></EmptyState>
        : !visible
          ? <EmptyState title="No matching clients"><p>Try another search or filter.</p></EmptyState>
          : <div className="advisor-home-table-wrap">
            <table className="advisor-home-table"><thead><tr><th scope="col">Client</th><th scope="col">Progress <span className="advisor-home-progress-help">Completed sharing and review steps</span></th><th scope="col">Stage</th><th scope="col">Documents</th><th scope="col">Next step</th></tr></thead>
              <tbody><tr><td><div className="advisor-home-client"><span className="advisor-home-initials">{initials(snapshot.founder.name)}</span><span><strong>{snapshot.founder.name}</strong><small>{snapshot.company}</small></span></div></td>
                <td><div className="advisor-home-progress"><div className="advisor-home-progress-track" role="progressbar" aria-label={snapshot.company + ' progress'} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: progress + '%' }}/></div><strong>{progress}%</strong><small>{completed} of 4 steps</small></div></td>
                <td><Badge tone={approved ? 'success' : questionsReturned ? 'attention' : 'neutral'}>{stage}</Badge></td>
                <td>{sharedPackets.length + sharedSources.length} shared</td>
                <td><div className="advisor-home-client-actions"><Link className={'button ' + (needsReview ? 'button-primary' : 'button-outline')} to={clientLink}>{action}</Link><Link to="/advisor/clients?audience=human#message-side">Message client</Link></div></td>
              </tr></tbody>
            </table>
          </div>}
    </section>

    <section className="advisor-home-section advisor-home-attention" aria-labelledby="advisor-home-attention-title">
      <h2 id="advisor-home-attention-title">Needs your attention</h2>
      <p>Clients waiting for your review.</p>
      {needsReview && hasClient
        ? <div className="advisor-home-attention-row"><div className="advisor-home-client"><span className="advisor-home-initials">{initials(snapshot.founder.name)}</span><span><strong>{snapshot.company}</strong><small>{snapshot.founder.name}</small></span></div><span>{activityText}</span><time dateTime={activityDate}>{activityDate ? new Date(activityDate).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</time><Link className="button button-primary" to={clientLink}>Review packet</Link></div>
        : <p className="advisor-home-all-clear">No client is waiting for your review.</p>}
    </section>
    <section className="advisor-home-section" aria-label="Shared documents">
      <h2>Shared documents</h2>
      <p>Only packet versions and originals in this advisor’s confirmed handoff appear here.</p>
      <Link className="button button-outline" to="/advisor/documents">View shared documents</Link>
    </section>
    <p className="advisor-home-scope-note">This local demo contains one assigned client. Progress is based on shared sources, a shared packet, returned questions, and approval.</p>
  </div></ScreenState>;
}
