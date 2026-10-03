import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useRelay } from './context';
import { Badge, Button, EmptyState, Icon, PageTitle, Panel } from './ui';

export default function Search():ReactNode {
  const {snapshot,role,mode}=useRelay();
  const [params,setParams]=useSearchParams();
  const query=params.get('q')??'';
  const filter=params.get('filter')??'all';
  const term=query.trim().toLowerCase();
  if(!snapshot)return null;
  const sources=snapshot.sources.filter(source=>[source.name,source.excerpt,...source.citations.map(c=>c.label)].join(' ').toLowerCase().includes(term));
  const documents=snapshot.packets.filter(packet=>[packet.title,packet.content,packet.status,...packet.changes].join(' ').toLowerCase().includes(term));
  const update=(key:string,value:string):void=>{const next=new URLSearchParams(params);if(value)next.set(key,value);else next.delete(key);setParams(next,{replace:true});};
  const sourceVisible=filter!=='documents';const documentVisible=filter!=='sources';
  const count=(sourceVisible?sources.length:0)+(documentVisible?documents.length:0);
  return <section className="utility-page"><PageTitle title="Search" subtitle={mode==='server'?'Find source and packet records in this local workflow case.':role==='founder'?'Find original sources and generated document versions.':'Search only the sources and versions shared with you.'}/>
    <Panel><label htmlFor="workspace-query">Search sources and drafts</label><div className="utility-search"><Icon name="search" size={18}/><input id="workspace-query" type="search" value={query} onChange={event=>update('q',event.target.value)} placeholder={mode==='server'?"Search names and stages":"Search by name or content"}/>{query&&<Button variant="subtle" onClick={()=>update('q','')}>Clear search</Button>}</div>
    <div className="search-filters" aria-label="Result types">{[{id:'all',label:'All',count:sources.length+documents.length},{id:'sources',label:'Sources',count:sources.length},{id:'documents',label:'Documents',count:documents.length}].map(item=><Button key={item.id} variant={filter===item.id?'primary':'outline'} aria-pressed={filter===item.id} onClick={()=>update('filter',item.id)}>{item.label} ({item.count})</Button>)}</div>
    <p role="status" className="muted">{count} result{count===1?'':'s'}{term?` for “${query}”`:''} · {mode==='server'?'Backend case':'Synthetic workspace'}</p></Panel>
    {count===0?<Panel><EmptyState title="No matching results"><p>Try a file name or a phrase from your documents.</p><Button variant="outline" onClick={()=>setParams({})}>Show all sources and documents</Button></EmptyState></Panel>:<>
    {sourceVisible&&sources.length>0&&<Panel title="Original sources"><div className="search-results">{sources.map(source=><article key={source.id}><Icon name="file" size={27}/><div><h3>{source.name}</h3>{source.excerpt&&<p>{source.excerpt.slice(0,160)}</p>}<Badge>Original · {source.extraction}</Badge></div><Link className="button button-outline" aria-label={`Open source ${source.name}`} to={`/${role}/${role==='founder'?'sources':'clients'}?source=${encodeURIComponent(source.id)}`}>Open source</Link></article>)}</div></Panel>}
    {documentVisible&&documents.length>0&&<Panel title="Generated documents"><div className="search-results">{[...documents].reverse().map(packet=><article key={packet.id}><Icon name="file" size={27}/><div><h3>{packet.title} · v{packet.version}</h3>{packet.changes.length>0&&<p>{packet.changes.join(' ')}</p>}<Badge>{packet.status.replaceAll('_',' ')}{mode==='fixture'?' · Simulated':''}</Badge></div><Link className="button button-outline" aria-label={`Open document ${packet.title} v${packet.version}`} to={`/${role}/documents?version=${encodeURIComponent(packet.id)}`}>Open document</Link></article>)}</div></Panel>}</>}
  </section>;
}
