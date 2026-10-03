import { MockRelayAdapter } from './mock';
import type { DemoState } from './mock';
import { RelayError } from './types';
import type { CaseSnapshot, MutationOptions, Receipt, RelayAdapter, RelayCommand, Role, Scenario } from './types';

interface StoredCase { generation:number; data:DemoState }
const databaseName='relay-local-demo-v2';
const lockName='relay-local-demo-case';

function openDatabase():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  if(!globalThis.indexedDB){reject(new RelayError('PERSISTENCE_UNAVAILABLE','Browser storage is unavailable. Enable IndexedDB to use this local demo.'));return;}
  const request=indexedDB.open(databaseName,1);
  request.onupgradeneeded=()=>{request.result.createObjectStore('state');};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(new RelayError('PERSISTENCE_UNAVAILABLE','Unable to open local browser storage.'));
 });
}

async function readCase():Promise<StoredCase|undefined>{
 const db=await openDatabase();
 try{return await new Promise<StoredCase|undefined>((resolve,reject)=>{
  const transaction=db.transaction('state','readonly');const request=transaction.objectStore('state').get('case');
  transaction.oncomplete=()=>resolve(request.result as StoredCase|undefined);
  transaction.onerror=()=>reject(new RelayError('PERSISTENCE_UNAVAILABLE','Unable to read local browser storage.'));
 });}finally{db.close();}
}

/** The read and generation check share one transaction, including without Web Locks. */
async function writeCase(expected:number,data:DemoState):Promise<number>{
 const db=await openDatabase();
 try{return await new Promise<number>((resolve,reject)=>{
  const transaction=db.transaction('state','readwrite');const store=transaction.objectStore('state');const request=store.get('case');let failure:RelayError|null=null;
  request.onsuccess=()=>{
   const current=request.result as StoredCase|undefined;
   if((current?.generation??0)!==expected){failure=new RelayError('STALE_REVISION','Another tab changed this workspace. Refresh and review before trying again.');transaction.abort();return;}
   store.put({generation:expected+1,data} satisfies StoredCase,'case');
  };
  transaction.oncomplete=()=>resolve(expected+1);
  transaction.onabort=()=>reject(failure??new RelayError('PERSISTENCE_UNAVAILABLE','The change could not be saved in this browser. No success was recorded.'));
  transaction.onerror=()=>{failure=new RelayError('PERSISTENCE_UNAVAILABLE','The change could not be saved in this browser. Check available storage.');};
 });}finally{db.close();}
}

class BrowserRelayAdapter implements RelayAdapter {
 readonly mode='simulated' as const;
 private readonly engine:MockRelayAdapter;
 private generation=0;
 private queue:Promise<unknown>=Promise.resolve();
 private readonly listeners=new Set<()=>void>();
 private readonly channel:BroadcastChannel|null;
 private persistenceError:unknown=null;
 private active=false;
 private scenario:Scenario='normal';
 constructor(latency:number){
  this.engine=new MockRelayAdapter(latency,async data=>{this.generation=await writeCase(this.generation,data);this.announce();});
  this.engine.subscribe(()=>this.emit());
  this.channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel(lockName);
  if(this.channel)this.channel.onmessage=()=>this.emit();
  if(typeof window!=='undefined')window.addEventListener('storage',event=>{if(event.key===lockName)this.emit();});
 }
 private emit():void{for(const listener of this.listeners)listener();}
 private announce():void{this.channel?.postMessage('changed');try{localStorage.setItem(lockName,crypto.randomUUID());}catch{/* IndexedDB remains authoritative if notification storage is unavailable. */}}
 private serialized<T>(operation:()=>Promise<T>):Promise<T>{
  const run=async():Promise<T>=>{
   if(this.persistenceError){const error=this.persistenceError;this.persistenceError=null;throw error;}
   const stored=await readCase();this.generation=stored?.generation??0;
   if(stored)this.engine.importState(stored.data);else{
    this.engine.importState(new MockRelayAdapter(0).exportState());
    try{this.generation=await writeCase(0,this.engine.exportState());}catch(error){if(!(error instanceof RelayError)||error.code!=='STALE_REVISION')throw error;const seeded=await readCase();if(!seeded)throw error;this.generation=seeded.generation;this.engine.importState(seeded.data);}
   }
   await this.engine.resumeDraft();
   this.active=true;try{return await operation();}catch(error){const latest=await readCase();if(latest)this.engine.importState(latest.data);throw error;}finally{this.active=false;}
  };
  const next=this.queue.then(async()=>{if(typeof navigator!=='undefined'&&navigator.locks)return await navigator.locks.request(lockName,{mode:'exclusive'},run);return await run();});
  this.queue=next.catch(()=>undefined);return next;
 }
 async snapshot(role:Role,signal?:AbortSignal):Promise<Receipt<CaseSnapshot>>{
  let stored=await readCase();
  if(!stored)return this.serialized(()=>this.engine.snapshot(role,signal));
  if(stored.data.pending){
   const resume=async():Promise<void>=>{
    const latest=await readCase();if(!latest?.data.pending)return;
    let generation=latest.generation;
    const recovery=new MockRelayAdapter(0,async data=>{generation=await writeCase(generation,data);this.announce();});recovery.importState(latest.data);await recovery.resumeDraft();this.emit();
   };
   if(typeof navigator!=='undefined'&&navigator.locks)await navigator.locks.request(lockName,{mode:'exclusive',ifAvailable:true},async lock=>{if(lock)await resume();});
   else if(!this.active){try{await resume();}catch(error){if(!(error instanceof RelayError)||error.code!=='STALE_REVISION')throw error;}}
   stored=(await readCase())??stored;
  }
  const reader=new MockRelayAdapter(0);reader.importState(stored.data);reader.setScenario(this.scenario);return reader.snapshot(role,signal);
 }
 mutate(role:Role,command:RelayCommand,options:MutationOptions):Promise<Receipt<CaseSnapshot>>{return this.serialized(()=>this.engine.mutate(role,command,options));}
 subscribe(listener:()=>void):()=>void{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 setScenario(scenario:Scenario):void{this.scenario=scenario;this.engine.setScenario(scenario);}
 reset():void{
  void this.serialized(async()=>{this.scenario='normal';this.engine.reset();this.generation=await writeCase(this.generation,this.engine.exportState());this.announce();this.emit();}).catch((error:unknown)=>{this.persistenceError=error;this.emit();});
 }
}

/** Same-origin, same-browser demo storage. No backend or cross-device synchronization. */
export function createBrowserRelayAdapter(latency=180):RelayAdapter{return new BrowserRelayAdapter(latency);}
