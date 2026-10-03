import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Badge, Button, EmptyState, Panel } from './ui';
import { documentUrl, LIVE_CASE_ID, listDocuments, resetChat, streamChat, uploadDocument } from './relayApi';
import type { LiveDocument } from './relayApi';
import type { Role } from './types';

interface Turn { id: string; author: 'you' | 'relay'; text: string }

const errorText = (error: unknown): string => error instanceof Error ? error.message : 'Request failed';
const newSessionId = (role: Role): string => `${role}-${crypto.randomUUID()}`;

/** Streaming chat with the backend Strands agent (POST /api/chat/stream). */
export function LiveAssistant({ role }: { role: Role }): ReactNode {
  const [sessionId, setSessionId] = useState(() => newSessionId(role));
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  // Evict the backend's cached agent when the conversation is replaced or the panel unmounts.
  useEffect(() => () => {
    controller.current?.abort();
    void resetChat(sessionId).catch(() => undefined);
  }, [sessionId]);

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || streaming) return;
    const replyId = crypto.randomUUID();
    setTurns(prev => [...prev, { id: crypto.randomUUID(), author: 'you', text }, { id: replyId, author: 'relay', text: '' }]);
    setDraft('');
    setError(null);
    setStreaming(true);
    const c = new AbortController();
    controller.current = c;
    try {
      await streamChat(sessionId, text, chunk => setTurns(prev => prev.map(turn => turn.id === replyId ? { ...turn, text: turn.text + chunk } : turn)), c.signal);
    } catch (e) {
      if (!c.signal.aborted) {
        setError(errorText(e));
        setTurns(prev => prev.filter(turn => turn.id !== replyId || turn.text));
      }
    } finally {
      if (controller.current === c) { controller.current = null; setStreaming(false); }
    }
  };

  const restart = (): void => {
    controller.current?.abort();
    setTurns([]);
    setError(null);
    setStreaming(false);
    setSessionId(newSessionId(role));
  };

  const inputId = `live-assistant-${role}`;
  return <Panel className="live-panel">
    <div className="live-heading">
      <div><h2>Relay assistant</h2><small>Live backend · Strands agent on Bedrock · separate from the local demo case</small></div>
      <Badge tone={streaming ? 'attention' : 'success'}>{streaming ? 'Replying…' : 'Live'}</Badge>
    </div>
    {turns.length === 0
      ? <p className="muted">Ask a general question. Replies stream from the backend agent and don't change the demo packet.</p>
      : <div className="message-list" aria-live="polite">{turns.map(turn => <div key={turn.id} className={`message ${turn.author === 'you' ? 'own-message' : ''}`}>
          <div className="message-author"><strong>{turn.author === 'you' ? 'You' : 'Relay assistant'}</strong></div>
          <div className="message-bubble">{turn.text || '…'}</div>
        </div>)}</div>}
    {error && <p className="feedback feedback-error" role="alert">{error}</p>}
    <form className="composer" onSubmit={e => { e.preventDefault(); void send(); }}>
      <label className="sr-only" htmlFor={inputId}>Message the live assistant</label>
      <textarea id={inputId} value={draft} maxLength={8000} placeholder="Ask the live assistant" disabled={streaming}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}/>
      <div className="composer-actions">
        <Button variant="outline" onClick={restart}>New conversation</Button>
        {streaming
          ? <Button variant="outline" onClick={() => controller.current?.abort()}>Stop</Button>
          : <Button type="submit" disabled={!draft.trim()}>Send</Button>}
      </div>
    </form>
  </Panel>;
}

export interface CaseDocuments {
  documents: LiveDocument[] | null;
  error: string | null;
  uploading: boolean;
  upload: (files: File[]) => Promise<void>;
  open: (documentId: string) => Promise<void>;
  refresh: () => void;
}

/** Case documents stored in S3 and recorded in Postgres: list, upload and open. */
export function useCaseDocuments(caseId: string = LIVE_CASE_ID): CaseDocuments {
  const [documents, setDocuments] = useState<LiveDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const c = new AbortController();
    setError(null);
    listDocuments(caseId, c.signal).then(setDocuments).catch((e: unknown) => { if (!c.signal.aborted) setError(errorText(e)); });
    return () => c.abort();
  }, [caseId, reload]);

  const upload = useCallback(async (files: File[]): Promise<void> => {
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of files) await uploadDocument(caseId, file);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUploading(false);
      setReload(n => n + 1);
    }
  }, [caseId]);

  const open = useCallback(async (documentId: string): Promise<void> => {
    setError(null);
    // Open the tab synchronously inside the click so popup blockers allow it, then point it at S3.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const url = await documentUrl(documentId);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (e) {
      tab?.close();
      setError(errorText(e));
    }
  }, []);

  const refresh = useCallback(() => setReload(n => n + 1), []);
  return { documents, error, uploading, upload, open, refresh };
}

/** Read-only or uploadable list of the case's backend documents. */
export function LiveCaseDocuments({ canUpload, caseId = LIVE_CASE_ID }: { canUpload: boolean; caseId?: string }): ReactNode {
  return <CaseDocumentsPanel canUpload={canUpload} docs={useCaseDocuments(caseId)} />;
}

export function CaseDocumentsPanel({ canUpload, docs }: { canUpload: boolean; docs: CaseDocuments }): ReactNode {
  const { documents, error, uploading, upload, open, refresh } = docs;
  return <Panel className="live-panel">
    <div className="live-heading">
      <div><h2>Case documents</h2><small>Stored in S3, recorded in Postgres</small></div>
      <div className="row wrap">
        <Button variant="outline" onClick={refresh}>Refresh</Button>
        {canUpload && <label className={`button button-primary live-upload ${uploading ? 'is-busy' : ''}`}>
          {uploading ? 'Uploading…' : 'Upload documents'}
          <input type="file" multiple disabled={uploading} aria-label="Upload documents"
            onChange={e => { void upload(Array.from(e.target.files ?? [])); e.target.value = ''; }}/>
        </label>}
      </div>
    </div>
    {error && <p className="feedback feedback-error" role="alert">{error}</p>}
    {documents === null
      ? !error && <p className="muted" role="status">Loading case documents…</p>
      : documents.length === 0
        ? <EmptyState title="No documents yet">{canUpload && <p>Upload a file to store it for this case.</p>}</EmptyState>
        : <div className="table-scroll"><table>
            <thead><tr><th scope="col">File</th><th scope="col">Uploaded</th></tr></thead>
            <tbody>{documents.map(doc => <tr key={doc.id}>
              <td><button type="button" className="table-button" onClick={() => { void open(doc.id); }}>{doc.filename}</button></td>
              <td>{new Date(doc.uploaded_at).toLocaleString()}</td>
            </tr>)}</tbody>
          </table></div>}
  </Panel>;
}
