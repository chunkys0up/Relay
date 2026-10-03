import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Icon, PacketPreview, SourcePreview } from './ui';
import { useRelay } from './context';
import ServerPacketLibrary from './ServerPacketLibrary';
import type { ServerCase } from './serverPacketApi';

function stage(state: ServerCase): string {
 const packet=state.packets.find(item=>item.id===state.current_packet_id) ?? state.packets.at(-1);
 return packet?.stage ? packet.stage.replaceAll('_',' ') : state.status;
}
export function ServerAdvisorHome() {
 const {cases,selectCase}=useRelay();
 const [query,setQuery]=useState('');
 const [filter,setFilter]=useState<'all'|'attention'|'review'>('all');
 if(!cases?.length)return <ServerPacketLibrary view="clients"/>;
 const visible=(cases??[]).filter(item=>{
  const packet=item.packets.find(value=>value.id===item.current_packet_id) ?? item.packets.at(-1);
  return item.company.toLowerCase().includes(query.toLowerCase()) && (filter==='all' || (filter==='review'?packet?.stage==='in_review':packet?.stage==='in_review'||packet?.stage==='questions_returned'));
 });
 return <div className="advisor-home"><header className="advisor-home-intro"><h1>Shared packet cases</h1><p>Packets and originals accepted by this advisor session.</p><div className="advisor-home-summary">{cases?.length ?? 0} shared case{cases?.length===1?'':'s'}</div></header>
  <section className="advisor-home-section"><h2>Packet cases</h2><div className="advisor-home-toolbar"><label className="advisor-home-search"><span className="sr-only">Search cases</span><Icon name="search" size={18}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search cases..."/></label><div className="advisor-home-filters" role="group" aria-label="Filter cases">{([['all','All cases'],['attention','Needs attention'],['review','In review']] as const).map(([value,text])=><button key={value} type="button" className={filter===value?'is-active':''} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{text}</button>)}</div></div>
   {visible.length===0?<p>No cases match this view.</p>:<div className="advisor-home-table-wrap"><table className="advisor-home-table"><thead><tr><th scope="col">Case</th><th scope="col">Tasks</th><th scope="col">Stage</th><th scope="col">Documents</th><th scope="col">Next step</th></tr></thead><tbody>{visible.map(item=><tr key={item.id}><td><strong>{item.company}</strong></td><td>{item.tasks.filter(task=>task.state==='done'||task.state==='Done').length} of {item.tasks.length} done</td><td><Badge>{stage(item)}</Badge></td><td>{item.packets.length} packets, {item.sources.length} originals</td><td><Link className="button button-outline" to="/advisor/clients" onClick={()=>selectCase?.(item.id)}>Open shared case</Link></td></tr>)}</tbody></table></div>}
  </section>
 </div>;
}
export function ServerAdvisorClients() {
 const {snapshot,cases,selectCase}=useRelay();
 const [selected,setSelected]=useState<string|null>(null);
 if(!snapshot)return <ServerPacketLibrary view="clients"/>;
 const packet=snapshot.packets.find(item=>item.id===selected) ?? snapshot.packets.find(item=>item.id===snapshot.current_packet_version_id) ?? snapshot.packets.at(-1);
 const source=snapshot.sources.find(item=>item.id===selected);
 return <div className="advisor-clients"><aside className="advisor-client-rail" aria-label="Shared packet cases"><h1>Shared cases</h1><div className="advisor-client-rail-list">{(cases??[]).map(item=><button key={item.id} className="advisor-client-choice" type="button" aria-current={item.id===snapshot.id?'true':undefined} onClick={()=>{selectCase?.(item.id);setSelected(null);}}><span className="advisor-client-choice-icon"><Icon name="folder" size={25}/></span><span><strong>{item.company}</strong><small>{stage(item)}</small></span><span aria-hidden="true">:</span></button>)}</div><p className="advisor-client-rail-note">Access is tied to the current shared packet version and hash.</p></aside>
  <section className="advisor-client-workspace" aria-label="Shared case documents"><nav className="advisor-client-breadcrumb" aria-label="Breadcrumb"><Link to="/advisor/home">Home</Link><span aria-hidden="true">:</span><strong>{snapshot.company}</strong></nav><header className="advisor-client-heading"><h2>{snapshot.company}</h2><p>Shared packet - {snapshot.status}</p><div className="advisor-client-heading-meta"><span><Icon name="file" size={20}/>{snapshot.packets.length+snapshot.sources.length} documents</span></div></header>
   <div className="advisor-client-documents">{[...snapshot.packets].reverse().map(item=><article className={'advisor-client-document '+(packet?.id===item.id&&!source?'is-expanded':'')} key={item.id}><button className="advisor-client-document-toggle" type="button" aria-expanded={packet?.id===item.id&&!source} onClick={()=>setSelected(item.id)}><Icon name="file" size={25}/><strong>{item.title} - v{item.version}</strong><Badge>{item.status.replaceAll('_',' ')}</Badge><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleDateString()}</time></button>{packet?.id===item.id&&!source&&<div className="advisor-client-document-content"><PacketPreview packet={item} compact/><Link className="button button-outline" to={`/advisor/documents?version=${encodeURIComponent(item.id)}`}>Review this packet</Link></div>}</article>)}
    {snapshot.sources.map(item=><article className={'advisor-client-document '+(source?.id===item.id?'is-expanded':'')} key={item.id}><button className="advisor-client-document-toggle" type="button" aria-expanded={source?.id===item.id} onClick={()=>setSelected(item.id)}><Icon name="file" size={25}/><strong>{item.name}</strong><Badge>Original</Badge></button>{source?.id===item.id&&<div className="advisor-client-document-content"><SourcePreview source={item}/></div>}</article>)}
    {snapshot.packets.length+snapshot.sources.length===0&&<p>No files saved in this case.</p>}</div>
  </section>
 </div>;
}
