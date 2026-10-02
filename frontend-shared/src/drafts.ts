/** Session-memory drafts, scoped by actor and audience; never sent automatically. */
const drafts=new Map<string,string>();
export function readDraft(key:string,fallback=''):string{return drafts.get(key)??fallback;}
export function writeDraft(key:string,value:string):void{drafts.set(key,value);}
export function clearDrafts():void{drafts.clear();}
