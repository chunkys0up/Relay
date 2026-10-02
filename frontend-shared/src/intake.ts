import { RelayError } from './types';
import type { RelayCommand, Source } from './types';

export async function readSource(command: Extract<RelayCommand, {kind:'upload'}>): Promise<Source> {
 if (!command.name.trim() || !Number.isSafeInteger(command.bytes) || command.bytes <= 0 || command.bytes > 10 * 1024 * 1024 || typeof command.content_base64 !== 'string') {
  throw new RelayError('VALIDATION_FAILED','Select a nonempty file up to 10 MB and read its actual bytes before adding it.');
 }
 let binary: string;
 try { binary = atob(command.content_base64); } catch { throw new RelayError('VALIDATION_FAILED','The source bytes are not valid base64.'); }
 if (binary.length !== command.bytes || btoa(binary) !== command.content_base64) throw new RelayError('VALIDATION_FAILED','The source bytes do not match the selected file.');
 const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
 const digest = await crypto.subtle.digest('SHA-256',bytes);
 const hash = Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
 const type = command.mime_type.split(';')[0].trim().toLowerCase();
 const textType = ['text/plain','text/csv','application/csv'].includes(type) || ((!type || type==='application/octet-stream') && /\.(txt|csv)$/i.test(command.name));
 let excerpt = ''; let error: string|null = 'Original bytes retained locally. Extraction is unsupported for this format; no text was inferred.';
 if (textType && !binary.startsWith('%PDF-')) {
  try {
   const decoded = new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   if ([...decoded].some(character=>{const code=character.charCodeAt(0);return code<32&&![9,10,13].includes(code);})) throw new Error('Binary content');
   excerpt = decoded; error = null;
  } catch { error = 'Original bytes retained locally. Only UTF-8 text and CSV extraction are supported.'; }
 }
 const id = crypto.randomUUID();
 return {id,revision:1,name:command.name,mime_type:command.mime_type || 'application/octet-stream',bytes:bytes.length,hash,created_at:new Date().toISOString(),extraction:error?'unsupported':'ready',excerpt,error,content_base64:command.content_base64,citations:error?[]:[{source_id:id,source_hash:hash,label:command.name+' · local text',locator:{field:'text'}}]};
}

export async function fileContentBase64(file: File): Promise<string> {
 if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw new RelayError('VALIDATION_FAILED','Select a nonempty file up to 10 MB.');
 const bytes = new Uint8Array(await file.arrayBuffer());
 let binary = '';
 for (let offset=0;offset<bytes.length;offset+=8192) binary += String.fromCharCode(...bytes.subarray(offset,offset+8192));
 return btoa(binary);
}
