import type { ReactNode } from 'react';

export function Tabs({id,label,items,value,onChange}:{id:string;label:string;items:readonly {id:string;label:string}[];value:string;onChange:(value:string)=>void}):ReactNode {
  return <div className="relay-tabs" role="tablist" aria-label={label}>{items.map((item,index)=><button key={item.id} id={`${id}-${item.id}-tab`} type="button" role="tab" aria-selected={value===item.id} aria-controls={`${id}-${item.id}-panel`} tabIndex={value===item.id?0:-1} onClick={()=>onChange(item.id)} onKeyDown={event=>{
    const next=event.key==='ArrowRight'?(index+1)%items.length:event.key==='ArrowLeft'?(index+items.length-1)%items.length:event.key==='Home'?0:event.key==='End'?items.length-1:null;
    if(next===null)return;
    event.preventDefault();onChange(items[next].id);document.getElementById(`${id}-${items[next].id}-tab`)?.focus();
  }}>{item.label}</button>)}</div>;
}
