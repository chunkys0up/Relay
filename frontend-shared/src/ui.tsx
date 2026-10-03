import { useEffect, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useRelay } from './context';
import { workspaceIdentity } from './identity';
import type { Citation, PacketVersion, Source } from './types';
export function Button({variant='primary',className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'outline'|'subtle'}):ReactNode{return <button type="button" className={`button button-${variant} ${className}`} {...props}/>;}
export function Panel({children,className='',title}:{children:ReactNode;className?:string;title?:string}):ReactNode{return <section className={`panel ${className}`}>{title&&<h2>{title}</h2>}{children}</section>;}
export function Badge({children,tone='neutral'}:{children:ReactNode;tone?:'neutral'|'attention'|'success'}):ReactNode{return <span className={`badge badge-${tone}`}>{children}</span>;}
export function Icon({name,size=22}:{name:'home'|'folder'|'file'|'call'|'settings'|'clients'|'review'|'search'|'agent'|'attach';size?:number}):ReactNode{return <span className="icon" style={{width:size,height:size}}><img src={`/assets/${name === 'file' && size <= 18 ? 'file-citation' : name === 'file' && size === 20 ? 'file-navigation' : name === 'file' && [25,26,27,32].includes(size) ? 'file-'+size : name === 'folder' && size === 35 ? 'folder-35' : name}.svg`} alt=""/></span>;}
export function PageTitle({title,subtitle,children}:{title:string;subtitle?:string;children?:ReactNode}):ReactNode{return <header className="page-title"><div><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div>{children}</header>;}
export function EmptyState({title,children}:{title:string;children?:ReactNode}):ReactNode{return <div className="empty-state"><Icon name="folder" size={32}/><h2>{title}</h2>{children}</div>;}
export function CitationLink({citation}:{citation:Citation}):ReactNode{const {role}=useRelay();const target=citation.source_kind==='message'?`${role==='founder'?'/founder/chat':'/advisor/documents'}?audience=human&message=${encodeURIComponent(citation.source_id)}#message-${citation.source_id}`:`${role==='founder'?'/founder/sources':'/advisor/clients'}?source=${encodeURIComponent(citation.source_id)}`;return <Link className="citation" to={target}><Icon name="file" size={18}/>{citation.label}</Link>;}
export function AgentStatus({state}:{state?:string}):ReactNode{const {snapshot}=useRelay();const effectiveState=state??snapshot?.ui_state??'Idle';return <div className="agent-status"><Icon name="agent" size={38}/><div><strong>{state==='Local notes'?'Private notes':'Relay assistant'}</strong><small>{state==='Local notes'?'Saved in this browser':'One AI assistant'}</small></div><Badge tone={effectiveState==='Needs input'?'attention':'neutral'}>{effectiveState}</Badge></div>;}
function ServerPdfFrame({url,title}:{url:string;title:string}):ReactNode {
 const [state,setState]=useState<{url:string;objectUrl:string|null;error:string|null}>({url,objectUrl:null,error:null});
 useEffect(()=>{
  const controller=new AbortController();let objectUrl:string|null=null;
  void fetch(url,{credentials:'same-origin',signal:controller.signal}).then(async response=>{
   if(!response.ok)throw new Error(`PDF preview failed (${response.status}).`);
   const bytes=await response.arrayBuffer();if(controller.signal.aborted)return;
   objectUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
   setState({url,objectUrl,error:null});
  }).catch((reason:unknown)=>{if(!controller.signal.aborted)setState({url,objectUrl:null,error:reason instanceof Error?reason.message:'PDF preview unavailable.'});});
  return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[url]);
 return state.url===url && state.error?<p role="alert">{state.error}</p>:state.url===url && state.objectUrl?<iframe className="server-pdf-preview" title={title} src={state.objectUrl}/>:<p role="status">Loading PDF preview...</p>;
}
export function SourcePreview({source}:{source:Source}):ReactNode{if(source.server_pdf_url)return <Panel title="Source preview"><div className="row"><Icon name="file" size={32}/><h3>{source.name}</h3><Badge>Original</Badge></div>{source.mime_type==='application/pdf'&&<ServerPdfFrame title={source.name} url={source.server_pdf_url}/>}<a className="button button-outline" href={source.server_pdf_url} target="_blank" rel="noopener noreferrer">Open original file</a></Panel>;return <Panel title="Source preview"><div className="row"><Icon name="file" size={32}/><h3>{source.name}</h3><Badge>{source.imported_pdf?'Original · S3 / Amazon Textract':source.content_base64===undefined?'Original · Synthetic fixture':'Original · Stored locally'}</Badge></div>{source.excerpt&&<pre className="source-excerpt">{source.excerpt}</pre>}<p className="muted">{source.imported_pdf?'Text extracted by Amazon Textract from the synthetic PDF stored in S3.':source.content_base64===undefined?'Synthetic fixture excerpt. No original file bytes are available.':source.error??'Actual UTF-8 text extracted locally. Original bytes are retained in this browser.'}</p>{source.imported_pdf&&<a className="button button-outline" href={source.imported_pdf.url} target="_blank" rel="noopener noreferrer">Open original PDF</a>}{source.content_base64!==undefined&&<a className="button button-outline" href={`data:${source.mime_type};base64,${source.content_base64}`} download={source.name}>Download local original</a>}{source.citations.map(c=><CitationLink key={c.label} citation={c}/>)}</Panel>;}
function ServerPacketPreview({packet,compact}:{packet:PacketVersion;compact:boolean}):ReactNode {
 const [text,setText]=useState<{id:string;status:'loading'|'readable'|'no_native_text'|'error';value:string}>({id:packet.id,status:'loading',value:''});
 useEffect(()=>{
  if(!packet.server_pdf_url)return;
  const controller=new AbortController();
  const url=packet.server_pdf_url.replace('/download?inline=true','/preview-text');
  void fetch(url,{credentials:'same-origin',signal:controller.signal}).then(async response=>{
   if(!response.ok)throw new Error('Packet text preview failed ('+response.status+').');
   const result=await response.json() as {status:'readable'|'no_native_text';text:string};
   if(!controller.signal.aborted)setText({id:packet.id,status:result.status,value:result.text});
  }).catch((reason:unknown)=>{if(!controller.signal.aborted)setText({id:packet.id,status:'error',value:reason instanceof Error?reason.message:'Packet text preview unavailable.'});});
  return()=>controller.abort();
 },[packet.id,packet.server_pdf_url]);
 const preview=text.id===packet.id?text:{id:packet.id,status:'loading' as const,value:''};
 return <section className={'packet-preview '+(compact?'compact':'')} aria-label={'Packet version '+packet.version+' preview'}>
  <div className="document-toolbar"><Icon name="file"/><strong>{packet.title} - v{packet.version}</strong><Badge tone={packet.status==='approved'?'success':'neutral'}>{packet.status.replaceAll('_',' ')}</Badge></div>
  <p className="server-pdf-note">This viewer loads the stored PDF. If your browser leaves it blank, use Open PDF or the verified text below.</p>
  {preview.status==='loading'?<p role="status">Loading verified PDF text...</p>:preview.status==='readable'?<details className="server-pdf-text" open><summary>Text extracted from this PDF</summary><pre>{preview.value}</pre></details>:preview.status==='no_native_text'?<p className="server-pdf-note">This PDF has no embedded text. Open PDF to inspect its pages.</p>:<p role="alert">{preview.value}</p>}
  {packet.server_pdf_url&&<><ServerPdfFrame title={'Packet v'+packet.version+' PDF'} url={packet.server_pdf_url}/><a className="button button-outline" href={packet.server_pdf_url} target="_blank" rel="noopener noreferrer">Open PDF</a></>}
 </section>;
}
export function PacketPreview({packet,compact=false}:{packet:PacketVersion;compact?:boolean}):ReactNode{const {snapshot}=useRelay();if(packet.server_pdf_url)return <ServerPacketPreview packet={packet} compact={compact}/>;const identity=workspaceIdentity(snapshot,'founder');return <section className={`packet-preview ${compact?'compact':''}`} aria-label={`Packet version ${packet.version} preview`}><div className="document-toolbar"><Icon name="file"/><strong>{packet.title} · v{packet.version}</strong><Badge tone={packet.status==='approved'?'success':'neutral'}>{packet.status.replaceAll('_',' ')} · simulated</Badge></div><article className="paper">{packet.imported_pdf&&<p><a href={packet.imported_pdf.url} target="_blank" rel="noopener noreferrer">Open original PDF</a> · Extracted by Amazon Textract</p>}<h2>{identity.companyName}</h2><h3>Founder planning packet</h3><p className="muted">Prepared for {identity.founderName} · Synthetic data</p><hr/><div className="packet-text">{packet.content.split('\n').map((line,i)=>/^\d\./.test(line)?<h4 key={i}>{line}</h4>:<p key={i}>{line||'\u00a0'}</p>)}</div><div className="packet-evidence">{packet.citations.map(citation=><CitationLink key={citation.source_id+ citation.label} citation={citation}/>)}</div><footer>Draft for discussion · v{packet.version} · Synthetic data</footer></article></section>;}
export function ScreenState({children}:{children:ReactNode}):ReactNode{const {snapshot,loading,error,refresh,mode,cases}=useRelay();if(loading&&!snapshot)return <div className="empty-state" role="status">Loading workspace…</div>;if(!snapshot && mode==='server' && !error && cases?.length===0)return children;if(!snapshot)return <EmptyState title="Workspace unavailable"><p role="alert">{error}</p><Button onClick={refresh}>Retry loading</Button></EmptyState>;return children;}
