import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { MockRelayAdapter } from './mock';
import type { CaseSnapshot, RelayCommand, Role, Scenario } from './types';
interface RelayContextValue { snapshot:CaseSnapshot|null;role:Role;loading:boolean;busy:boolean;error:string|null;notice:string|null;scenario:Scenario;run:(command:RelayCommand)=>Promise<boolean>;refresh:()=>void;cancel:()=>void;setScenario:(s:Scenario)=>void;clearNotice:()=>void }
const Context=createContext<RelayContextValue|null>(null);
export const adapter=new MockRelayAdapter();
export function RelayProvider({role,children}:{role:Role;children:ReactNode}):ReactNode{
 const [snapshot,setSnapshot]=useState<CaseSnapshot|null>(null);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [notice,setNotice]=useState<string|null>(null);const [scenario,setScenarioState]=useState<Scenario>('normal');
 const controller=useRef<AbortController|null>(null);const mutation=useRef<AbortController|null>(null);const pending=useRef(false);const mounted=useRef(true);
 const refresh=useCallback(()=>{controller.current?.abort();const c=new AbortController();controller.current=c;setLoading(true);setError(null);void adapter.snapshot(role,c.signal).then(r=>{if(!c.signal.aborted)setSnapshot(r.data);}).catch((e:unknown)=>{if(!c.signal.aborted){setError(e instanceof Error?e.message:'Unable to load');setSnapshot(null);}}).finally(()=>{if(!c.signal.aborted)setLoading(false);});},[role]);
 useEffect(()=>{mounted.current=true;setSnapshot(null);setNotice(null);refresh();const unsub=adapter.subscribe(refresh);return()=>{mounted.current=false;controller.current?.abort();mutation.current?.abort();unsub();};},[refresh]);
 const run=async(command:RelayCommand):Promise<boolean>=>{if(pending.current)return false;pending.current=true;setBusy(true);setError(null);setNotice(null);const c=new AbortController();mutation.current=c;try{const r=await adapter.mutate(role,command,{key:crypto.randomUUID(),signal:c.signal});if(mounted.current){setSnapshot(r.data);setNotice('Simulation updated only. Nothing was uploaded, sent to a real person, or saved to a backend.');}return true;}catch(e:unknown){if(mounted.current)setError(c.signal.aborted?'Request cancelled before the simulated result.':e instanceof Error?e.message:'Action failed');return false;}finally{pending.current=false;if(mounted.current)setBusy(false);}};
 return <Context.Provider value={{snapshot,role,loading,busy,error,notice,scenario,run,refresh,cancel:()=>mutation.current?.abort(),setScenario:s=>{setScenarioState(s);adapter.setScenario(s);},clearNotice:()=>{setError(null);setNotice(null);}}}>{children}</Context.Provider>;
}
export function useRelay():RelayContextValue{const value=useContext(Context);if(!value)throw new Error('RelayProvider required');return value;}
