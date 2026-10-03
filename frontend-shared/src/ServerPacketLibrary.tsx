import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, EmptyState, Icon, PacketPreview, PageTitle, Panel, SourcePreview } from './ui';
import { useRelay } from './context';
import type { PacketVersion } from './types';
import ServerReturnedAnswer from './ServerReturnedAnswer';

type View = 'home' | 'documents' | 'clients' | 'sources';
function stageLabel(stage: PacketVersion['status']): string {
  return { draft: 'Draft', in_review: 'In review', questions_returned: 'Questions returned', approved: 'Approved' }[stage];
}
function date(value: string | undefined): string {
  return value ? new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'Time unavailable';
}
export default function ServerPacketLibrary({ view }: { view: View }) {
  const { snapshot, cases, role, serverActorRole, inviteCode, busy, error, notice, loading, createCase, loadExamples, importPacket, stagePacket, createShare, revokeShare, redeemShare, reviewPacket, retrySync } = useRelay();
  const [params, setParams] = useSearchParams();
  const [company, setCompany] = useState('');
  const [goal, setGoal] = useState('');
  const [confirmStage, setConfirmStage] = useState(false);
  const [shareSources,setShareSources]=useState<string[]>([]);
  const [redeemCode,setRedeemCode]=useState('');
  const [reviewNote,setReviewNote]=useState('');
  const [reviewDecision,setReviewDecision]=useState<'approved'|'questions_returned'|null>(null);
  const selected = snapshot?.packets.find(item => item.id === params.get('version'))
    ?? snapshot?.packets.find(item => item.id === snapshot.current_packet_version_id)
    ?? snapshot?.packets.at(-1) ?? null;
  const source = snapshot?.sources.find(item => item.id === params.get('source')) ?? (view==='sources' && !params.has('version') ? snapshot?.sources[0] : null) ?? null;
  const title = view === 'home' ? 'Packet workspace' : view === 'clients' ? 'Local packet cases' : view === 'sources' ? 'Original sources' : 'Documents';
  const select = (key: 'version' | 'source', id: string): void => {
    const next = new URLSearchParams(params);
    next.set(key, id);
    next.delete(key === 'source' ? 'version' : 'source');
    setParams(next);
    setConfirmStage(false);
  };
  if (loading && !snapshot) return <p role="status">Loading packet cases from the backend...</p>;
  if (!snapshot && cases?.length === 0) return <div className="server-packet-library">
    <PageTitle title="No packet cases yet" subtitle="Create a case to begin storing sources and packet PDFs on the workflow backend."/>
    {role === 'founder' && serverActorRole==='founder' && <Panel title="Create a case"><form onSubmit={event => {event.preventDefault();if(company.trim() && goal.trim()) void createCase?.(company.trim(),goal.trim());}}>
      <label>Company<input value={company} onChange={event=>setCompany(event.target.value)} required maxLength={120}/></label>
      <label>Planning goal<input value={goal} onChange={event=>setGoal(event.target.value)} required maxLength={500}/></label>
      <Button type="submit" disabled={busy || !company.trim() || !goal.trim()}>Create case</Button>
    </form></Panel>}
    {role === 'founder' && serverActorRole==='founder' && <Button variant="outline" disabled={busy} onClick={()=>{void loadExamples?.();}}>Load example packet cases</Button>}
    {role === 'advisor' && <Panel title="Accept a packet invitation"><p>Use an invitation code from the founder in this separate browser session. A role switch in the founder session does not grant access.</p><form onSubmit={event=>{event.preventDefault();if(redeemCode.trim())void redeemShare?.(redeemCode.trim()).then(ok=>{if(ok)setRedeemCode('');});}}><label>Invitation code<input value={redeemCode} onChange={event=>setRedeemCode(event.target.value)} required autoComplete="off"/></label><Button type="submit" disabled={busy||!redeemCode.trim()}>Accept invitation</Button></form></Panel>}
    {role === 'founder' && serverActorRole==='advisor' && <p>This browser session is an advisor session. Open the advisor view to see shared packets.</p>}
    {error&&<p role="alert">{error}</p>}
  </div>;
  if (!snapshot) return <EmptyState title="Packet backend unavailable"><p role="alert">{error ?? 'No server case loaded.'}</p></EmptyState>;
  return <div className="server-packet-library">
    <PageTitle title={title} subtitle={role === 'advisor' ? 'Packets and originals shared with this advisor session. Reviews are saved for the exact PDF version and hash.' : 'Packet stages and PDFs are read from the workflow backend.'}/>
    {role==='founder' && <div className="server-packet-actions"><label className="button button-outline">Import packet PDF<input className="sr-only" type="file" accept=".pdf,application/pdf" aria-label="Import packet PDF" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void importPacket?.(file);}}/></label><Button variant="outline" disabled={busy} onClick={()=>{void loadExamples?.();}}>Load example packet cases</Button></div>}
    <div className="server-packet-summary"><strong>{snapshot.company}</strong>{snapshot.server_synthetic_example&&<Badge>Synthetic example</Badge>}<span>{snapshot.packets.length} packet{snapshot.packets.length === 1 ? '' : 's'}</span><span>{snapshot.sources.length} original{snapshot.sources.length === 1 ? '' : 's'}</span><span>Legacy service sync: {snapshot.server_legacy_sync_status ?? 'unconfigured'}</span></div>
    {(snapshot.server_legacy_sync_status === 'failed' || snapshot.server_legacy_sync_status === 'pending' || snapshot.server_legacy_sync_status === 'unconfigured' && snapshot.packets.length+snapshot.sources.length>0) && role === 'founder' && <Button variant="outline" disabled={busy} onClick={()=>{void retrySync?.();}}>Retry storage sync</Button>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    <div className="server-packet-grid">
      <aside className="server-packet-rail" aria-label="Packet and source files">
        <h2>Packet PDFs</h2>
        {snapshot.packets.length === 0 && <p>No packet PDFs have been saved for this case.</p>}
        {[...snapshot.packets].reverse().map(packet=><button key={packet.id} className={selected?.id === packet.id && !source ? 'is-selected' : ''} type="button" onClick={()=>select('version',packet.id)}><Icon name="file" size={20}/><span><strong>{packet.title}</strong><small>v{packet.version} - {date(packet.created_at)}</small></span><Badge tone={packet.status==='approved'?'success':packet.status==='questions_returned'?'attention':'neutral'}>{stageLabel(packet.status)}</Badge></button>)}
        <h2>Original sources</h2>
        {snapshot.sources.length === 0 && <p>No originals saved in this case.</p>}
        {snapshot.sources.map(item=><button key={item.id} className={source?.id===item.id?'is-selected':''} type="button" onClick={()=>select('source',item.id)}><Icon name="file" size={20}/><span><strong>{item.name}</strong><small>{item.mime_type || 'File'} - cloud {item.cloud_status ?? 'unconfigured'}</small></span></button>)}
      </aside>
      <section className="server-packet-content" aria-label="Document preview">
        {source ? <SourcePreview source={source}/> : selected ? <>
          <PacketPreview packet={selected}/>
          <Panel title="Recorded stage"><div className="row wrap"><Badge tone={selected.status==='approved'?'success':selected.status==='questions_returned'?'attention':'neutral'}>{stageLabel(selected.status)}</Badge><span>Exact PDF hash: <code>{selected.hash}</code></span></div>
            <p>Cloud copy: {selected.cloud_status ?? 'unconfigured'}</p>
            <h3>Stage history</h3>
            {selected.stage_events?.length ? <ol>{selected.stage_events.map((event,index)=><li key={event.id ?? index}>{event.action ?? event.stage ?? 'Stage recorded'} - {event.actor ?? 'Actor unspecified'} - {date(event.at ?? event.created_at)}</li>)}</ol> : <p>No stage changes have been recorded for this PDF.</p>}
            {role==='founder' && selected.id===snapshot.current_packet_version_id && selected.status==='draft' && <>
              {confirmStage ? <div className="confirm-panel"><p>Record packet v{selected.version} as in review? This updates the local workflow stage. It does not grant advisor access.</p><Button disabled={busy} onClick={()=>{void stagePacket?.(selected,'in_review').then(ok=>{if(ok)setConfirmStage(false);});}}>Confirm stage change</Button><Button variant="outline" onClick={()=>setConfirmStage(false)}>Cancel</Button></div>
                : <Button onClick={()=>setConfirmStage(true)}>Move to review stage</Button>}
            </>}
            {role==='founder' && selected.id===snapshot.current_packet_version_id && selected.status==='in_review' && <div className="confirm-panel"><h3>Share this exact packet</h3><p>Invite an advisor to packet v{selected.version}. Choose any originals they may read. The invitation can be accepted once in another browser session.</p>
              {snapshot.sources.map(item=><label key={item.id}><input type="checkbox" checked={shareSources.includes(item.id)} onChange={event=>setShareSources(ids=>event.target.checked?[...ids,item.id]:ids.filter(id=>id!==item.id))}/>{item.name}</label>)}
              <Button disabled={busy} onClick={()=>{void createShare?.(selected,shareSources);}}>Create invitation</Button>
              {inviteCode&&<p role="status">Invitation code: <code>{inviteCode}</code></p>}
            </div>}
            {role==='founder' && (snapshot.grants.length>0 || (cases?.find(item=>item.id===snapshot.id)?.shares?.length??0)>0) && <div><h3>Invitations</h3><ol>{cases?.find(item=>item.id===snapshot.id)?.shares?.filter(item=>item.packet_id===selected.id).map(item=><li key={item.id}>{item.active?'Advisor access active':item.grant_id?'Access revoked':'Awaiting acceptance'} - {item.created_at?date(item.created_at):'Time unavailable'} {!item.grant_id&&!item.active?'':null}<Button variant="outline" disabled={busy||(!item.active&&item.grant_id!==null)} onClick={()=>{void revokeShare?.(item.id);}}>Revoke</Button></li>)}</ol></div>}
            {role==='advisor' && selected.id===snapshot.current_packet_version_id && selected.status==='in_review' && <div className="confirm-panel"><h3>Review packet v{selected.version}</h3><p>Your decision is bound to PDF hash <code>{selected.hash}</code>.</p>
              <label>Review note<textarea value={reviewNote} onChange={event=>setReviewNote(event.target.value)} placeholder="Describe questions or context for the founder"/></label>
              {reviewDecision ? <div><p>Save {reviewDecision==='approved'?'approval':'questions returned'} for this exact PDF?</p><Button disabled={busy||(reviewDecision==='questions_returned'&&!reviewNote.trim())} onClick={()=>{void reviewPacket?.(selected,reviewDecision,reviewNote).then(ok=>{if(ok){setReviewDecision(null);setReviewNote('');}});}}>Confirm review</Button><Button variant="outline" onClick={()=>setReviewDecision(null)}>Cancel</Button></div>
                : <div className="row wrap"><Button disabled={busy} onClick={()=>setReviewDecision('approved')}>Approve version</Button><Button variant="outline" disabled={busy||!reviewNote.trim()} onClick={()=>setReviewDecision('questions_returned')}>Return questions</Button></div>}
            </div>}
          </Panel>
          {role==='founder' && serverActorRole==='founder' && selected.id===snapshot.current_packet_version_id && selected.status==='questions_returned' && snapshot.reviews.filter(review=>review.packet_version_id===selected.id&&review.packet_hash===selected.hash&&review.decision==='questions_returned').map(review=><ServerReturnedAnswer key={review.id} caseId={snapshot.id} packet={selected} review={review}/>)}
          {role==='founder' && serverActorRole==='founder' && selected.id===snapshot.current_packet_version_id && selected.status==='questions_returned' && !snapshot.reviews.some(review=>review.packet_version_id===selected.id&&review.packet_hash===selected.hash&&review.decision==='questions_returned') && <Panel title="Example questions returned"><p>This synthetic example has a stage label but no saved advisor review or question. {snapshot.activity}</p><p>Confirm the missing source-backed facts on Home, then generate a new private packet. An actual advisor return will show its exact note and an answer form here.</p></Panel>}
        </> : <EmptyState title="No packet selected"><p>Saved packet PDFs will appear here.</p></EmptyState>}
      </section>
    </div>
  </div>;
}
