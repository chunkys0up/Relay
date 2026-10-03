import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './ui';
import { useRelay } from './context';
import { workflowRequest, WorkflowRequestError } from '../../client-frontend/src/workflow/api';
import { getServerCase } from './serverPacketApi';
import ServerPacketLibrary from './ServerPacketLibrary';
import ServerWorkflowPanel from './ServerWorkflowPanel';

type Filter = 'all' | 'originals' | 'packets';
function label(stage: string): string {
 return { draft: 'Draft', in_review: 'In review', questions_returned: 'Questions returned', approved: 'Approved' }[stage] ?? stage;
}
export default function ServerCaseHome() {
 const { snapshot, cases, refresh, busy, importPacket, loadExamples, retrySync, createCase } = useRelay();
 const [query,setQuery]=useState('');
 const [newCompany,setNewCompany]=useState('');
 const [newGoal,setNewGoal]=useState('');
 const [filter,setFilter]=useState<Filter>('all');
 const [uploading,setUploading]=useState(false);
 const [uploadError,setUploadError]=useState<string|null>(null);
 const input=useRef<HTMLInputElement>(null);
 const packetInput=useRef<HTMLInputElement>(null);
 if (!snapshot) return <ServerPacketLibrary view="home"/>;
 const normalized=query.trim().toLowerCase();
 const sources=snapshot.sources.filter(item=>filter!=='packets' && item.name.toLowerCase().includes(normalized));
 const packets=snapshot.packets.filter(item=>filter!=='originals' && (item.title+' '+item.status).toLowerCase().includes(normalized));
 const upload=async(event:ChangeEvent<HTMLInputElement>):Promise<void>=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  setUploading(true);setUploadError(null);
  try{const form=new FormData();form.set('expected_revision',String(snapshot.revision));form.set('file',file);
   try{await workflowRequest<unknown>(`/cases/${encodeURIComponent(snapshot.id)}/sources`,{method:'POST',file:form});}
   catch(reason){if(!(reason instanceof WorkflowRequestError)||reason.code!=='STALE_REVISION')throw reason;
    const latest=await getServerCase(snapshot.id);form.set('expected_revision',String(latest.revision));
    await workflowRequest<unknown>('/cases/'+encodeURIComponent(snapshot.id)+'/sources',{method:'POST',file:form});
   }
   refresh();
  }catch(reason){setUploadError(reason instanceof Error?reason.message:'Upload failed.');}finally{setUploading(false);}
 };
 return <div className="founder-home"><div className="founder-home-content">
  <header className="founder-home-intro"><span className="founder-home-avatar" aria-hidden="true">{snapshot.company.slice(0,2).toUpperCase()}</span><div><h1>{snapshot.company}</h1><p>Your planning packet workspace{snapshot.server_synthetic_example?' - synthetic example':''} - {cases?.length ?? 1} backend case{cases?.length===1?'':'s'}</p></div></header>
  <details><summary>Create another case</summary><form onSubmit={event=>{event.preventDefault();if(newCompany.trim()&&newGoal.trim())void createCase?.(newCompany.trim(),newGoal.trim());}}><label>Company<input value={newCompany} onChange={event=>setNewCompany(event.target.value)} maxLength={120} required/></label><label>Planning goal<input value={newGoal} onChange={event=>setNewGoal(event.target.value)} maxLength={500} required/></label><button className="button button-outline" disabled={busy||!newCompany.trim()||!newGoal.trim()}>Create case</button></form></details>
  <section className="founder-home-documents" aria-labelledby="founder-home-documents-title">
   <div className="founder-home-heading"><h2 id="founder-home-documents-title">Your documents</h2><p>Original files and generated packet PDFs saved to this case.</p></div>
   <div className="founder-home-toolbar"><label className="founder-home-search"><Icon name="search" size={20}/><span className="sr-only">Search documents</span><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search documents..."/></label>
    <div className="founder-home-filters" aria-label="Document type">{([['all','All documents'],['originals','Original files'],['packets','Packets']] as const).map(([value,text])=><button key={value} type="button" aria-pressed={filter===value} onClick={()=>setFilter(value)}>{text}</button>)}</div>
   </div>
   <div className="founder-home-dropzone"><span className="founder-home-upload-icon" aria-hidden="true">+</span><strong>Upload an original source</strong><span>PDF, text, or CSV up to 10 MB</span><button type="button" className="founder-home-upload-button" disabled={uploading || busy} onClick={()=>input.current?.click()}>{uploading?'Uploading...':'Choose file'}</button><input ref={input} type="file" className="sr-only" accept=".pdf,.txt,.csv,application/pdf,text/plain,text/csv" aria-label="Upload original source" onChange={event=>{void upload(event);}}/><small>Stored in this workflow case. Uploading does not share it with an advisor.</small></div>
   <div className="server-packet-actions"><button className="button button-outline" type="button" onClick={()=>packetInput.current?.click()} disabled={busy}>Import packet PDF</button><input ref={packetInput} className="sr-only" type="file" accept=".pdf,application/pdf" aria-label="Import packet PDF" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void importPacket?.(file);}}/><button className="button button-outline" type="button" onClick={()=>{void loadExamples?.();}} disabled={busy}>Load example packet cases</button></div>
   {uploadError&&<p className="founder-home-feedback is-error" role="alert">{uploadError}</p>}
   <div className="founder-home-file-list" aria-label="Documents"><div className="founder-home-file-head"><span>Name</span><span>Type</span><span>Status</span></div>
    {sources.map(item=><div className="founder-home-file-row" key={item.id}><Link className="founder-home-file-name" to={`/founder/sources?source=${encodeURIComponent(item.id)}`}><Icon name="file" size={25}/><span>{item.name}</span></Link><span>Original</span><span className="founder-home-status">{item.extraction} - cloud {item.cloud_status ?? 'unconfigured'}</span></div>)}
    {[...packets].reverse().map(item=><div className="founder-home-file-row" key={item.id}><Link className="founder-home-file-name" to={`/founder/documents?version=${encodeURIComponent(item.id)}`}><Icon name="file" size={25}/><span>{item.title} v{item.version}</span></Link><span>PDF packet</span><span className={`founder-home-status ${item.status==='approved'?'is-ready':'is-draft'}`}>{label(item.status)} - cloud {item.cloud_status ?? 'unconfigured'}</span></div>)}
    {sources.length+packets.length===0&&<p className="founder-home-no-documents">{normalized?'No documents match this search.':'No documents in this view yet.'}</p>}
   </div>
  </section><ServerWorkflowPanel key={snapshot.id} caseId={snapshot.id} revision={snapshot.revision} refresh={refresh}/></div><aside className="case-sidebar" aria-label="Case progress"><h2>Case progress</h2><p>{snapshot.status}</p><p>Legacy service sync: {snapshot.server_legacy_sync_status ?? 'unconfigured'}</p>{(snapshot.server_legacy_sync_status==='failed'||snapshot.server_legacy_sync_status==='unconfigured'&&snapshot.packets.length+snapshot.sources.length>0)&&<button className="button button-outline" type="button" disabled={busy} onClick={()=>{void retrySync?.();}}>Retry storage sync</button>}<p>{snapshot.tasks.filter(item=>item.state==='Done').length} of {snapshot.tasks.length} recorded tasks done</p>{snapshot.tasks.length>0&&<ul>{snapshot.tasks.map(item=><li key={item.id}>{item.title} - {item.state}</li>)}</ul>}<p>Packet stage changes do not grant advisor access.</p></aside></div>;
}
