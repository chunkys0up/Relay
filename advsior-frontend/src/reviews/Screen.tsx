import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Badge, Button, CitationLink, Conversation, EmptyState, Icon, PageTitle,
  Panel, ReviewControls, ScreenState, useRelay,
} from '@relay/shared';
import './Screen.css';

function writeParams(search: URLSearchParams, setSearch: (next: URLSearchParams) => void, updates: Record<string,string|null>): void {
  const next = new URLSearchParams(search);
  for (const [key,value] of Object.entries(updates)) {
    if (value) next.set(key,value);
    else next.delete(key);
  }
  setSearch(next);
}

function decisionLabel(status: string): {label:string;tone:'attention'|'neutral'|'success'} {
  if (status === 'approved') return {label:'Approved version',tone:'success'};
  if (status === 'questions_returned') return {label:'Questions returned',tone:'neutral'};
  if (status === 'in_review') return {label:'Review required',tone:'attention'};
  return {label:'Draft shared',tone:'neutral'};
}

export default function Screen() {
  const { snapshot, role } = useRelay();
  const [params,setParams] = useSearchParams();
  const query = (params.get('q') ?? '').trim().toLowerCase();
  const packets = useMemo(() => {
    if (!snapshot || role !== 'advisor') return [];
    return snapshot.packets.filter(packet => snapshot.grants.some(grant =>
      grant.advisor_id === snapshot.advisors[0]?.id
      && grant.packet_version_id === packet.id
      && grant.packet_hash === packet.hash,
    ));
  },[role,snapshot]);
  const rows = packets.filter(packet => `${snapshot?.company} ${packet.title} v${packet.version}`.toLowerCase().includes(query));
  const requested = params.get('version');
  const selected = packets.find(packet => packet.id === requested || String(packet.version) === requested)
    ?? packets.find(packet => packet.id === snapshot?.current_packet_version_id)
    ?? packets.at(-1)
    ?? null;
  const flags = selected ? snapshot?.flags.filter(flag => flag.packet_version_id === selected.id) ?? [] : [];
  const reviews = selected ? snapshot?.reviews.filter(review => review.packet_version_id === selected.id).sort((a,b)=>a.created_at.localeCompare(b.created_at)) ?? [] : [];
  const latestReview = reviews.at(-1);
  const state = selected ? decisionLabel(latestReview?.decision ?? selected.status) : null;
  const updated = selected ? latestReview?.created_at ?? selected.created_at : null;

  return <ScreenState>
    {!snapshot || role !== 'advisor' ? null : <div className="advisor-reviews">
      <section className="advisor-reviews-main">
        <PageTitle title="Reviews" subtitle="Your assigned client reviews" />
        {!packets.length
          ? <EmptyState title="No assigned reviews"><p>Reviews appear when a founder shares a specific packet version with you.</p></EmptyState>
          : <>
            <div className="advisor-reviews-toolbar">
              <label className="advisor-review-search"><span className="sr-only">Search assigned reviews</span><Icon name="search" size={18}/><input value={params.get('q') ?? ''} placeholder="Search reviews" onChange={event=>writeParams(params,setParams,{q:event.currentTarget.value||null})}/></label>
              <Badge>Assigned to {snapshot.advisors[0]?.name ?? 'you'}</Badge>
            </div>
            {rows.length===0
              ? <Panel className="advisor-reviews-empty"><EmptyState title="No matching assigned review"><p>Search checks packet versions already shared with this advisor.</p><Button variant="outline" onClick={()=>writeParams(params,setParams,{q:null})}>Clear search</Button></EmptyState></Panel>
              : <div className="advisor-review-table-wrap">
                <div className="table-scroll advisor-review-table-scroll"><table className="advisor-review-table">
                  <thead><tr><th scope="col">Client &amp; item</th><th scope="col">Status</th><th scope="col">Updated</th></tr></thead>
                  <tbody>{rows.map(packet=>{
                    const decision=snapshot.reviews.filter(review=>review.packet_version_id===packet.id).sort((a,b)=>a.created_at.localeCompare(b.created_at)).at(-1);
                    const status=decisionLabel(decision?.decision??packet.status);
                    const date=decision?.created_at??packet.created_at;
                    const isSelected=selected?.id===packet.id;
                    return <tr key={packet.id} className={isSelected?'is-selected':''}><td><button type="button" className="advisor-review-row" aria-pressed={isSelected} onClick={()=>writeParams(params,setParams,{version:packet.id})}><Icon name="file" size={22}/><span><strong>{snapshot.company}</strong><small>{packet.title} · v{packet.version}</small></span></button></td><td><Badge tone={status.tone}>{status.label}</Badge></td><td><time dateTime={date}>{new Date(date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</time></td></tr>;
                  })}</tbody>
                </table></div>
                <p className="advisor-review-count">{rows.length} shared packet version{rows.length===1?'':'s'} · exact-version decisions</p>
              </div>}
            {selected && <Panel className="advisor-review-detail">
              <header className="advisor-review-detail-head"><div className="row"><Icon name="file" size={24}/><div><h2>{snapshot.company}</h2><p>{selected.title} · v{selected.version}</p></div></div><div className="advisor-review-meta"><span>Assigned to {snapshot.advisors[0]?.name ?? 'you'}</span>{state&&<Badge tone={state.tone}>{state.label}</Badge>}</div></header>
              <div className="advisor-review-issues"><h3>Source issues</h3>{flags.length?flags.map(flag=><article className="advisor-review-issue" key={flag.id}><span className="advisor-issue-mark" aria-hidden="true">•</span><div><strong>{flag.kind==='missing'?'Missing detail':flag.kind==='conflict'?'Financial conflict':'Uncertain detail'}</strong><p>{flag.text}</p>{flag.citations.map(citation=><CitationLink key={citation.source_id+citation.label} citation={citation}/>)}</div></article>):<p className="muted">No unresolved source flags are attached to this version.</p>}</div>
              <div className="advisor-review-actions"><Link className="button button-outline" to={`/advisor/documents?version=${encodeURIComponent(selected.id)}`}>Open document review</Link></div>
              {selected.id===snapshot.current_packet_version_id
                ? <div className="advisor-review-controls"><ReviewControls packet={selected}/></div>
                : <p className="advisor-review-stale" role="status">This shared version is historical. Decisions apply only to the latest packet version.</p>}
              {updated&&<p className="advisor-review-updated">Version activity · {new Date(updated).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</p>}
            </Panel>}
          </>}
      </section>
      <aside className="advisor-reviews-assistant" aria-label="Review conversation">
        <header className="advisor-reviews-assistant-head"><Icon name="agent" size={38}/><div><strong>Conversation</strong><span>{snapshot.advisors[0]?.name} · Advisor &nbsp; {snapshot.founder.name} · Founder</span></div></header>
        <Link className="button button-outline advisor-reviews-call" to="/advisor/call">Open Call ↗</Link>
        <div className="advisor-reviews-conversation"><Conversation/></div>
      </aside>
    </div>}
  </ScreenState>;
}
