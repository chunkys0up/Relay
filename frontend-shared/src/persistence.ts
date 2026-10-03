import { MockRelayAdapter } from './mock';
import type { DemoState } from './mock';
import { RelayError } from './types';
import type { CaseSnapshot, MutationOptions, Receipt, RelayAdapter, RelayCommand, Role, Scenario } from './types';

interface StoredCase { generation:number; data:DemoState }
const fixtureDatabaseName='relay-local-demo-v2';
const fixtureLockName='relay-local-demo-case';
const connectedDatabasePrefix='relay-connected-sample-v1-';
const connectedLockPrefix='relay-connected-sample-case-';

export interface BrowserRelayAdapterOptions {
 seedLoader?: (signal?:AbortSignal)=>Promise<CaseSnapshot>;
}

export async function sampleFingerprint(state:CaseSnapshot):Promise<string>{
 // Original and extracted-content hashes identify the imported PDFs. Reloading
 // unchanged files keeps local edits; changed files get a fresh local copy.
 const payload=JSON.stringify({case_id:state.id,
  packets:state.packets.map(item=>[item.id,item.hash,item.imported_pdf?.original_sha256]),
  sources:state.sources.map(item=>[item.id,item.hash,item.imported_pdf?.original_sha256]),
  grants:state.grants.map(item=>[item.packet_version_id,item.packet_hash,[...item.source_ids].sort()])});
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload));
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

function openDatabase(databaseName:string):Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  if(!globalThis.indexedDB){reject(new RelayError('PERSISTENCE_UNAVAILABLE','Browser storage is unavailable. Enable IndexedDB to use this local demo.'));return;}
  const request=indexedDB.open(databaseName,1);
  request.onupgradeneeded=()=>{request.result.createObjectStore('state');};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(new RelayError('PERSISTENCE_UNAVAILABLE','Unable to open local browser storage.'));
 });
}

async function readCase(databaseName:string):Promise<StoredCase|undefined>{
 const db=await openDatabase(databaseName);
 try{return await new Promise<StoredCase|undefined>((resolve,reject)=>{
  const transaction=db.transaction('state','readonly');const request=transaction.objectStore('state').get('case');
  transaction.oncomplete=()=>resolve(request.result as StoredCase|undefined);
  transaction.onerror=()=>reject(new RelayError('PERSISTENCE_UNAVAILABLE','Unable to read local browser storage.'));
 });}finally{db.close();}
}

/** The read and generation check share one transaction, including without Web Locks. */
async function writeCase(databaseName:string,expected:number,data:DemoState):Promise<number>{
 const db=await openDatabase(databaseName);
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
 private channel:BroadcastChannel|null=null;
 private persistenceError:unknown=null;
 private active=false;
 private scenario:Scenario='normal';
 private databaseName:string=fixtureDatabaseName;
 private lockName:string=fixtureLockName;
 private readonly seedLoader:BrowserRelayAdapterOptions['seedLoader'];
 private seedState:DemoState|null=null;
 private bootstrap:Promise<void>|null=null;
 constructor(latency:number,options:BrowserRelayAdapterOptions){
  this.seedLoader=options.seedLoader;
  this.engine=new MockRelayAdapter(latency,async data=>{this.generation=await writeCase(this.databaseName,this.generation,data);this.announce();});
  this.engine.subscribe(()=>this.emit());
  if(!this.seedLoader)this.connectChannel();
  if(typeof window!=='undefined')window.addEventListener('storage',event=>{if(event.key===this.lockName)this.emit();});
 }
 private connectChannel():void{
  this.channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel(this.lockName);
  if(this.channel)this.channel.onmessage=()=>this.emit();
 }
 private async ready():Promise<void>{
  if(!this.seedLoader)return;
  if(!this.bootstrap){
   this.bootstrap=(async()=>{
    const state=await this.seedLoader!();
    const fingerprint=await sampleFingerprint(state);
    this.seedState={state,receipts:[],pending:null};
    this.databaseName=connectedDatabasePrefix+fingerprint;
    this.lockName=connectedLockPrefix+fingerprint;
    this.connectChannel();
   })().catch(error=>{this.bootstrap=null;throw error;});
  }
  await this.bootstrap;
 }
 private emit():void{for(const listener of this.listeners)listener();}
 private announce():void{this.channel?.postMessage('changed');try{localStorage.setItem(this.lockName,crypto.randomUUID());}catch{/* IndexedDB remains authoritative if notification storage is unavailable. */}}
 private initialState():DemoState{
  if(this.seedLoader){
   if(!this.seedState)throw new RelayError('CONNECTED_SAMPLE_UNAVAILABLE','Imported PDF data has not loaded.');
   return structuredClone(this.seedState);
  }
  return new MockRelayAdapter(0).exportState();
 }
 private serialized<T>(operation:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
  const run=async():Promise<T>=>{
   if(this.persistenceError){const error=this.persistenceError;this.persistenceError=null;throw error;}
   const stored=await readCase(this.databaseName);this.generation=stored?.generation??0;
   if(stored)this.engine.importState(stored.data);else{
    if(signal?.aborted)throw new DOMException('Request cancelled','AbortError');
    this.engine.importState(this.initialState());
    try{this.generation=await writeCase(this.databaseName,0,this.engine.exportState());}catch(error){if(!(error instanceof RelayError)||error.code!=='STALE_REVISION')throw error;const seeded=await readCase(this.databaseName);if(!seeded)throw error;this.generation=seeded.generation;this.engine.importState(seeded.data);}
   }
   await this.engine.resumeDraft();
   this.active=true;try{return await operation();}catch(error){const latest=await readCase(this.databaseName);if(latest)this.engine.importState(latest.data);throw error;}finally{this.active=false;}
  };
  const next=this.queue.then(async()=>{await this.ready();if(signal?.aborted)throw new DOMException('Request cancelled','AbortError');if(typeof navigator!=='undefined'&&navigator.locks)return await navigator.locks.request(this.lockName,{mode:'exclusive'},run);return await run();});
  this.queue=next.catch(()=>undefined);return next;
 }
 async snapshot(role:Role,signal?:AbortSignal):Promise<Receipt<CaseSnapshot>>{
  await this.ready();
  if(signal?.aborted)throw new DOMException('Request cancelled','AbortError');
  let stored=await readCase(this.databaseName);
  if(!stored)return this.serialized(()=>this.engine.snapshot(role,signal),signal);
  if(stored.data.pending){
   const resume=async():Promise<void>=>{
    const latest=await readCase(this.databaseName);if(!latest?.data.pending)return;
    let generation=latest.generation;
    const recovery=new MockRelayAdapter(0,async data=>{generation=await writeCase(this.databaseName,generation,data);this.announce();});recovery.importState(latest.data);await recovery.resumeDraft();this.emit();
   };
   if(typeof navigator!=='undefined'&&navigator.locks)await navigator.locks.request(this.lockName,{mode:'exclusive',ifAvailable:true},async lock=>{if(lock)await resume();});
   else if(!this.active){try{await resume();}catch(error){if(!(error instanceof RelayError)||error.code!=='STALE_REVISION')throw error;}}
   stored=(await readCase(this.databaseName))??stored;
  }
  const reader=new MockRelayAdapter(0);reader.importState(stored.data);reader.setScenario(this.scenario);return reader.snapshot(role,signal);
 }
 mutate(role:Role,command:RelayCommand,options:MutationOptions):Promise<Receipt<CaseSnapshot>>{return this.serialized(()=>this.engine.mutate(role,command,options));}
 subscribe(listener:()=>void):()=>void{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 setScenario(scenario:Scenario):void{this.scenario=scenario;this.engine.setScenario(scenario);}
 reset():void{
  void this.serialized(async()=>{this.scenario='normal';this.engine.setScenario('normal');this.engine.importState(this.initialState());this.generation=await writeCase(this.databaseName,this.generation,this.engine.exportState());this.announce();this.emit();}).catch((error:unknown)=>{this.persistenceError=error;this.emit();});
 }
}

/** Same-origin browser storage. Connected sample content is a local copy of scoped service PDFs. */
export function createBrowserRelayAdapter(latency=180,options:BrowserRelayAdapterOptions={}):RelayAdapter{return new BrowserRelayAdapter(latency,options);}
