import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, EmptyState, Panel } from './ui';
import { announceCaseUpdate, CASE_UPDATED_EVENT, documentUrl, LIVE_CASE_ID, listActivity, listChats, listChecklist, listDocuments, recentChatMessages, setChecklistState, uploadDocument } from './relayApi';
import type { ActivityEntry, ChatKind, ChatMessage, ChatRole, ChatSummary, ChecklistItem, ChecklistState, LiveDocument } from './relayApi';

const errorText = (error: unknown): string => error instanceof Error ? error.message : 'Request failed';

/** Re-run a fetch whenever the case changes (AI reply, message, upload, checklist tick). */
export function useCaseReload(): number {
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const bump = (): void => setReload(n => n + 1);
    window.addEventListener(CASE_UPDATED_EVENT, bump);
    return () => window.removeEventListener(CASE_UPDATED_EVENT, bump);
  }, []);
  return reload;
}

/** Plain-text preview of a markdown message, for short blurbs. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, '')
    .replace(/[*_~`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Saved conversations of one kind visible to this role, most recently active first. */
export function useChats(kind: ChatKind, role: ChatRole, caseId: string = LIVE_CASE_ID): { chats: ChatSummary[] | null; error: string | null } {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCaseReload();
  useEffect(() => {
    const c = new AbortController();
    listChats(caseId, kind, role, c.signal).then(next => { setChats(next); setError(null); }).catch((e: unknown) => { if (!c.signal.aborted) setError(errorText(e)); });
    return () => c.abort();
  }, [caseId, kind, role, reload]);
  return { chats, error };
}

/** The latest messages across this role's conversations, for previews. */
export function useRecentMessages(role: ChatRole, limit = 3, caseId: string = LIVE_CASE_ID): ChatMessage[] | null {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const reload = useCaseReload();
  useEffect(() => {
    const c = new AbortController();
    recentChatMessages(caseId, role, limit, c.signal).then(setMessages).catch(() => { if (!c.signal.aborted) setMessages([]); });
    return () => c.abort();
  }, [caseId, role, limit, reload]);
  return messages;
}

export interface CaseChecklist { items: ChecklistItem[] | null; error: string | null; setState: (itemId: string, state: ChecklistState) => Promise<void> }

/** The case checklist the chat agent maintains; the founder can tick items off. */
export function useCaseChecklist(caseId: string = LIVE_CASE_ID): CaseChecklist {
  const [items, setItems] = useState<ChecklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCaseReload();
  useEffect(() => {
    const c = new AbortController();
    listChecklist(caseId, c.signal).then(next => { setItems(next); setError(null); }).catch((e: unknown) => { if (!c.signal.aborted) setError(errorText(e)); });
    return () => c.abort();
  }, [caseId, reload]);
  const setState = useCallback(async (itemId: string, state: ChecklistState): Promise<void> => {
    setItems(prev => prev?.map(item => item.id === itemId ? { ...item, state } : item) ?? prev);
    try { await setChecklistState(caseId, itemId, state); } catch (e) { setError(errorText(e)); }
    announceCaseUpdate();
  }, [caseId]);
  return { items, error, setState };
}

/** Recent case activity: uploads, checklist changes and notes the agent logs. */
export function useCaseActivity(caseId: string = LIVE_CASE_ID, limit = 8): { entries: ActivityEntry[] | null; error: string | null } {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCaseReload();
  useEffect(() => {
    const c = new AbortController();
    listActivity(caseId, limit, c.signal).then(next => { setEntries(next); setError(null); }).catch((e: unknown) => { if (!c.signal.aborted) setError(errorText(e)); });
    return () => c.abort();
  }, [caseId, limit, reload]);
  return { entries, error };
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
  const [localReload, setReload] = useState(0);
  const caseReload = useCaseReload();
  const reload = localReload + caseReload;

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
      announceCaseUpdate();
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
