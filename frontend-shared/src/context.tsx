import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createBrowserRelayAdapter } from './persistence';
import { loadCloudFixture } from './cloudFixture';
import { readDraft,writeDraft } from './drafts';
import type { CaseSnapshot, RelayCommand, Role, Scenario } from './types';
interface RelayContextValue { snapshot:CaseSnapshot|null;role:Role;loading:boolean;busy:boolean;error:string|null;notice:string|null;scenario:Scenario;run:(command:RelayCommand,options?:{silent?:boolean})=>Promise<boolean>;refresh:()=>void;cancel:()=>void;setScenario:(s:Scenario)=>void;clearNotice:()=>void }
const Context=createContext<RelayContextValue|null>(null);
const fixtureMode=import.meta.env.VITE_PACKET_DATA_MODE==='fixture'||import.meta.env.MODE==='test';
export const adapter=fixtureMode?createBrowserRelayAdapter():createBrowserRelayAdapter(180,{seedLoader:loadCloudFixture});
export function RelayProvider({role,children}:{role:Role;children:ReactNode}):ReactNode{
 const [snapshot,setSnapshot]=useState<CaseSnapshot|null>(null);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [notice,setNotice]=useState<string|null>(null);const [scenario,setScenarioState]=useState<Scenario>('normal');
 const controller=useRef<AbortController|null>(null);const mutation=useRef<AbortController|null>(null);const pending=useRef(false);const mounted=useRef(true);
 const refresh=useCallback(()=>{controller.current?.abort();const c=new AbortController();controller.current=c;setLoading(true);setError(null);void adapter.snapshot(role,c.signal).then(r=>{if(!c.signal.aborted)setSnapshot(r.data);}).catch((e:unknown)=>{if(!c.signal.aborted){setError(e instanceof Error?e.message:'Unable to load');setSnapshot(null);}}).finally(()=>{if(!c.signal.aborted)setLoading(false);});},[role]);
 useEffect(()=>{mounted.current=true;setSnapshot(null);setNotice(null);refresh();const unsub=adapter.subscribe(refresh);return()=>{mounted.current=false;controller.current?.abort();mutation.current?.abort();unsub();};},[refresh]);
 const run=async(command:RelayCommand,options:{silent?:boolean}={}):Promise<boolean>=>{if(pending.current)return false;pending.current=true;if(!options.silent){setBusy(true);setError(null);setNotice(null);}const c=new AbortController();mutation.current=c;try{const r=await adapter.mutate(role,command,{key:crypto.randomUUID(),signal:c.signal});if(mounted.current){setSnapshot(r.data);if(!options.silent)setNotice(c.signal.aborted?'The local demo job was recorded and completed. Cancelling the wait did not undo it.':'Saved in this browser. Same-origin tabs share this local demo; nothing was sent to a real person or saved to a backend.');}return true;}catch(e:unknown){if(mounted.current)setError(c.signal.aborted?'Request cancelled before the local result.':e instanceof Error?e.message:'Action failed');return false;}finally{pending.current=false;if(mounted.current)setBusy(false);}};
 return <Context.Provider value={{snapshot,role,loading,busy,error,notice,scenario,run,refresh,cancel:()=>mutation.current?.abort(),setScenario:s=>{setScenarioState(s);adapter.setScenario(s);},clearNotice:()=>{setError(null);setNotice(null);}}}>{children}</Context.Provider>;
}
export function useRelay():RelayContextValue{const value=useContext(Context);if(!value)throw new Error('RelayProvider required');return value;}
export function useDraft(key:string,fallback=''):[string,(text:string)=>void]{const {role}=useRelay();const [,render]=useState(0);const scoped=role+':'+key;return [readDraft(scoped,fallback),text=>{writeDraft(scoped,text);render(value=>value+1);}];}
