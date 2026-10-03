import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createBrowserRelayAdapter } from './persistence';
import { readDraft,writeDraft } from './drafts';
import type { CaseSnapshot, PacketVersion, RelayCommand, Role, Scenario } from './types';
import { changeServerPacketStage, createServerCase, createServerShare, getServerCase, importServerPacket, listServerCases, loadServerExamples, mapServerCase, redeemServerShare, retryServerCaseSync, reviewServerPacket, revokeServerShare } from './serverPacketApi';
import type { ServerCase } from './serverPacketApi';
import { initializeWorkflowSession, WorkflowRequestError } from '../../client-frontend/src/workflow/api';
interface RelayContextValue { snapshot:CaseSnapshot|null;role:Role;serverActorRole?:Role|null;inviteCode?:string|null;loading:boolean;busy:boolean;error:string|null;notice:string|null;scenario:Scenario;mode:'fixture'|'server';cases?:ServerCase[];selectedCaseId?:string|null;selectCase?:(id:string)=>void;createCase?:(company:string,goal:string)=>Promise<boolean>;loadExamples?:()=>Promise<boolean>;importPacket?:(file:File)=>Promise<boolean>;stagePacket?:(packet:PacketVersion,stage:PacketVersion['status'])=>Promise<boolean>;createShare?:(packet:PacketVersion,sourceIds:string[])=>Promise<boolean>;revokeShare?:(id:string)=>Promise<boolean>;redeemShare?:(code:string)=>Promise<boolean>;reviewPacket?:(packet:PacketVersion,decision:'approved'|'questions_returned',note:string)=>Promise<boolean>;retrySync?:()=>Promise<boolean>;run:(command:RelayCommand,options?:{silent?:boolean})=>Promise<boolean>;refresh:()=>void;cancel:()=>void;setScenario:(s:Scenario)=>void;clearNotice:()=>void }
const Context=createContext<RelayContextValue|null>(null);
const fixtureMode=import.meta.env.VITE_PACKET_DATA_MODE==='fixture'||import.meta.env.MODE==='test';
export const adapter=createBrowserRelayAdapter();
function FixtureRelayProvider({role,children}:{role:Role;children:ReactNode}):ReactNode{
 const [snapshot,setSnapshot]=useState<CaseSnapshot|null>(null);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [notice,setNotice]=useState<string|null>(null);const [scenario,setScenarioState]=useState<Scenario>('normal');
 const controller=useRef<AbortController|null>(null);const mutation=useRef<AbortController|null>(null);const pending=useRef(false);const mounted=useRef(true);
 const refresh=useCallback(()=>{controller.current?.abort();const c=new AbortController();controller.current=c;setLoading(true);setError(null);void adapter.snapshot(role,c.signal).then(r=>{if(!c.signal.aborted)setSnapshot(r.data);}).catch((e:unknown)=>{if(!c.signal.aborted){setError(e instanceof Error?e.message:'Unable to load');setSnapshot(null);}}).finally(()=>{if(!c.signal.aborted)setLoading(false);});},[role]);
 useEffect(()=>{mounted.current=true;setSnapshot(null);setNotice(null);refresh();const unsub=adapter.subscribe(refresh);return()=>{mounted.current=false;controller.current?.abort();mutation.current?.abort();unsub();};},[refresh]);
 const run=async(command:RelayCommand,options:{silent?:boolean}={}):Promise<boolean>=>{if(pending.current)return false;pending.current=true;if(!options.silent){setBusy(true);setError(null);setNotice(null);}const c=new AbortController();mutation.current=c;try{const r=await adapter.mutate(role,command,{key:crypto.randomUUID(),signal:c.signal});if(mounted.current){setSnapshot(r.data);if(!options.silent)setNotice(c.signal.aborted?'The local demo job was recorded and completed. Cancelling the wait did not undo it.':'Saved in this browser. Same-origin tabs share this local demo; nothing was sent to a real person or saved to a backend.');}return true;}catch(e:unknown){if(mounted.current)setError(c.signal.aborted?'Request cancelled before the local result.':e instanceof Error?e.message:'Action failed');return false;}finally{pending.current=false;if(mounted.current)setBusy(false);}};
 return <Context.Provider value={{snapshot,role,loading,busy,error,notice,scenario,mode:'fixture',run,refresh,cancel:()=>mutation.current?.abort(),setScenario:s=>{setScenarioState(s);adapter.setScenario(s);},clearNotice:()=>{setError(null);setNotice(null);}}}>{children}</Context.Provider>;
}

const selectedCaseStorageKey='relay-selected-workflow-case';
export function ServerRelayProvider({role,children}:{role:Role;children:ReactNode}):ReactNode {
 const [cases,setCases]=useState<ServerCase[]>([]);
 const [snapshot,setSnapshot]=useState<CaseSnapshot|null>(null);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [notice,setNotice]=useState<string|null>(null);
 const [serverActorRole,setServerActorRole]=useState<Role|null>(null);
 const [inviteCode,setInviteCode]=useState<string|null>(null);
 const [selectedId,setSelectedId]=useState<string|null>(()=>{try{return localStorage.getItem(selectedCaseStorageKey);}catch{return null;}});
 const controller=useRef<AbortController|null>(null);
 const refresh=useCallback((preserveError=false)=>{
  controller.current?.abort();
  const current=new AbortController();controller.current=current;setLoading(true);if(!preserveError)setError(null);
  void initializeWorkflowSession().then(async session=>{
   const actorRole=session.actor?.role??'founder';
   if(current.signal.aborted)return;
   setServerActorRole(actorRole);
   if(actorRole!==role){setCases([]);setSnapshot(null);return;}
   return listServerCases(current.signal);
  }).then(async items=>{
   if(!items)return;
   if(current.signal.aborted)return;
   setCases(items);
   const chosen=items.find(item=>item.id===selectedId)?.id??items[0]?.id;
   if(!chosen){setSnapshot(null);return;}
   const state=await getServerCase(chosen,current.signal);
   if(current.signal.aborted)return;
   setSelectedId(chosen);setSnapshot(mapServerCase(state));
  }).catch((reason:unknown)=>{if(!current.signal.aborted){setError(reason instanceof Error?reason.message:'Unable to load server cases.');setSnapshot(null);}})
   .finally(()=>{if(!current.signal.aborted)setLoading(false);});
 },[selectedId,role]);
 useEffect(()=>{refresh();return()=>controller.current?.abort();},[refresh]);
 const syncUnconfigured=snapshot?.server_legacy_sync_status==='unconfigured'&&Boolean(snapshot.packets.length+snapshot.sources.length);
 const syncPending=snapshot?.server_legacy_sync_status==='pending'||snapshot?.packets.some(item=>item.cloud_status==='pending')||snapshot?.sources.some(item=>item.cloud_status==='pending')||syncUnconfigured;
 useEffect(()=>{
  if(!syncPending||busy)return;
  let attempts=0;
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible'){if(syncUnconfigured&&++attempts>30){window.clearInterval(timer);return;}refresh(true);}},4000);
  const visible=():void=>{if(document.visibilityState==='visible')refresh(true);};
  document.addEventListener('visibilitychange',visible);
  return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[syncPending,syncUnconfigured,busy,refresh]);
 const selectCase=(id:string):void=>{if(!cases.some(item=>item.id===id))return;if(id===selectedId){if(snapshot?.id!==id)refresh();return;}setLoading(true);setSnapshot(null);try{localStorage.setItem(selectedCaseStorageKey,id);}catch{/* Selection remains available in this tab. */}setSelectedId(id);};
 const createCase=async(company:string,goal:string):Promise<boolean>=>{
  setBusy(true);setError(null);try{const state=await createServerCase(company,goal);setCases(items=>[...items,state]);setLoading(true);setSnapshot(null);try{localStorage.setItem(selectedCaseStorageKey,state.id);}catch{/* Selection remains available in this tab. */}setSelectedId(state.id);setNotice('Case saved to the workflow backend.');return true;}
  catch(reason){setError(reason instanceof Error?reason.message:'Unable to create case.');return false;}finally{setBusy(false);}
 };
 const loadExamples=async():Promise<boolean>=>{
  setBusy(true);setError(null);
  try{const loaded=await loadServerExamples();const first=loaded[0];if(!first)throw new Error('The backend returned no example cases.');
   setCases(items=>[...items,...loaded]);setLoading(true);setSnapshot(null);
   try{localStorage.setItem(selectedCaseStorageKey,first.id);}catch{/* Selection remains available in this tab. */}
   setSelectedId(first.id);setNotice('Example packet cases saved to this backend session.');return true;
  }catch(reason){setError(reason instanceof Error?reason.message:'Unable to load example cases.');return false;}finally{setBusy(false);}
 };
 const importPacket=async(file:File):Promise<boolean>=>{
  if(!snapshot)return false;setBusy(true);setError(null);
  try{try{await importServerPacket(snapshot.id,snapshot.revision,file);}
   catch(reason){if(!(reason instanceof WorkflowRequestError)||reason.code!=='STALE_REVISION')throw reason;
    const latest=await getServerCase(snapshot.id);await importServerPacket(snapshot.id,latest.revision,file);
   }
   const state=await getServerCase(snapshot.id);setSnapshot(mapServerCase(state));setCases(items=>items.map(item=>item.id===state.id?state:item));
   setNotice('Packet PDF imported and saved to the backend.');return true;
  }catch(reason){refresh();setError(reason instanceof Error?reason.message:'Unable to import packet PDF.');return false;}finally{setBusy(false);}
 };
 const stagePacket=async(packet:PacketVersion,stage:PacketVersion['status']):Promise<boolean>=>{
  if(!snapshot)return false;setBusy(true);setError(null);setNotice(null);
  try{try{await changeServerPacketStage(snapshot.id,packet,snapshot.revision,stage,crypto.randomUUID());}
   catch(reason){if(!(reason instanceof WorkflowRequestError)||reason.code!=='STALE_REVISION')throw reason;
    const latest=await getServerCase(snapshot.id);
    const exact=latest.packets.find(item=>item.id===packet.id);
    if(!exact||exact.hash!==packet.hash||exact.stage!==packet.status)throw new Error('This packet changed. Review its current version before changing the stage.');
    await changeServerPacketStage(snapshot.id,packet,latest.revision,stage,crypto.randomUUID());
   }
   const state=await getServerCase(snapshot.id);setSnapshot(mapServerCase(state));setCases(items=>items.map(item=>item.id===state.id?state:item));
   setNotice('Packet stage saved to the workflow backend.');return true;
  }catch(reason){refresh();setError(reason instanceof Error?reason.message:'Unable to change packet stage.');return false;}finally{setBusy(false);}
 };
 const createShare=async(packet:PacketVersion,sourceIds:string[]):Promise<boolean>=>{
  if(!snapshot||serverActorRole!=='founder')return false;
  setBusy(true);setError(null);
  const key=crypto.randomUUID();
  try{let result:{id:string;invite_code:string};
   try{result=await createServerShare(snapshot.id,packet,snapshot.revision,sourceIds,key);}
   catch(reason){if(!(reason instanceof WorkflowRequestError)||reason.code!=='STALE_REVISION')throw reason;
    const latest=await getServerCase(snapshot.id);
    const exact=latest.packets.find(item=>item.id===packet.id);
    if(latest.current_packet_id!==packet.id||!exact||exact.hash!==packet.hash||exact.stage!=='in_review')
     throw new Error('This packet changed. Review the current version before sharing it.');
    if(!sourceIds.every(id=>latest.sources.some(source=>source.id===id)))
     throw new Error('The selected originals changed. Review the sharing selection again.');
    result=await createServerShare(snapshot.id,packet,latest.revision,sourceIds,key);
   }
   setInviteCode(result.invite_code);
   refresh();setNotice('Invitation created for this exact packet. Share the code with the advisor in a separate browser session.');return true;
  }catch(reason){refresh(true);setError(reason instanceof Error?reason.message:'Unable to create invitation.');return false;}finally{setBusy(false);}
 };
 const revokeShare=async(id:string):Promise<boolean>=>{
  if(!snapshot||serverActorRole!=='founder')return false;
  setBusy(true);setError(null);
  try{await revokeServerShare(snapshot.id,id);setInviteCode(null);refresh();setNotice('Advisor access revoked.');return true;
  }catch(reason){setError(reason instanceof Error?reason.message:'Unable to revoke access.');return false;}finally{setBusy(false);}
 };
 const redeemShare=async(code:string):Promise<boolean>=>{
  setBusy(true);setError(null);
  try{const result=await redeemServerShare(code);
   try{localStorage.setItem(selectedCaseStorageKey,result.case_id);}catch{/* The next refresh still selects the granted case. */}
   setSelectedId(result.case_id);refresh();setNotice('Invitation accepted. This advisor session can review the shared packet.');return true;
  }catch(reason){setError(reason instanceof Error?reason.message:'Unable to accept invitation.');return false;}finally{setBusy(false);}
 };
 const reviewPacket=async(packet:PacketVersion,decision:'approved'|'questions_returned',note:string):Promise<boolean>=>{
  if(!snapshot||serverActorRole!=='advisor')return false;
  setBusy(true);setError(null);
  const key=crypto.randomUUID();
  try{try{await reviewServerPacket(snapshot.id,packet,snapshot.revision,decision,note,key);}
   catch(reason){if(!(reason instanceof WorkflowRequestError)||reason.code!=='STALE_REVISION')throw reason;
    const latest=await getServerCase(snapshot.id);
    const exact=latest.packets.find(item=>item.id===packet.id);
    if(latest.current_packet_id!==packet.id||!exact||exact.hash!==packet.hash||exact.stage!=='in_review')
     throw new Error('This packet changed. Review its current version before saving a decision.');
    await reviewServerPacket(snapshot.id,packet,latest.revision,decision,note,key);
   }
   refresh();setNotice('Review saved for packet v'+packet.version+'.');return true;
  }catch(reason){refresh(true);setError(reason instanceof Error?reason.message:'Unable to save review.');return false;}finally{setBusy(false);}
 };
 const retrySync=async():Promise<boolean>=>{
  if(!snapshot)return false;setBusy(true);setError(null);
  try{const state=await retryServerCaseSync(snapshot.id);setSnapshot(mapServerCase(state));setCases(items=>items.map(item=>item.id===state.id?state:item));
   setNotice(state.legacy_sync?.status==='synced'?'Storage sync completed.':'Storage sync requested. The case will update when the backend finishes.');return true;
  }catch(reason){setError(reason instanceof Error?reason.message:'Unable to retry storage sync.');return false;}finally{setBusy(false);}
 };
 const run=async():Promise<boolean>=>{setError('This action is not connected to the workflow backend.');return false;};
 return <Context.Provider value={{snapshot,role,serverActorRole,inviteCode,loading,busy,error,notice,scenario:'normal',mode:'server',cases,selectedCaseId:selectedId,selectCase,createCase,loadExamples,importPacket,stagePacket,createShare,revokeShare,redeemShare,reviewPacket,retrySync,run,refresh,cancel:()=>controller.current?.abort(),setScenario:()=>{},clearNotice:()=>{setError(null);setNotice(null);}}}>{children}</Context.Provider>;
}
export function RelayProvider({role,children}:{role:Role;children:ReactNode}):ReactNode {
 return fixtureMode?<FixtureRelayProvider role={role}>{children}</FixtureRelayProvider>:<ServerRelayProvider role={role}>{children}</ServerRelayProvider>;
}
export function useRelay():RelayContextValue{const value=useContext(Context);if(!value)throw new Error('RelayProvider required');return value;}
export function useDraft(key:string,fallback=''):[string,(text:string)=>void]{const {role}=useRelay();const [,render]=useState(0);const scoped=role+':'+key;return [readDraft(scoped,fallback),text=>{writeDraft(scoped,text);render(value=>value+1);}];}
