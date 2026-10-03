import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import type { FormEvent, ReactNode } from 'react';
import { useDraft, useRelay } from './context';
import { writeDraft } from './drafts';
import { useCaseReload, useChats } from './live';
import { MarkdownText } from './markdown';
import { announceCaseUpdate, createChat, documentUrl, LIVE_CASE_ID, listChatMessages, sendChatMessage, streamChat, uploadDocument } from './relayApi';
import type { ChatFile, ChatKind, ChatMessage } from './relayApi';
import { Tabs } from './tabs';
import { AgentStatus, Badge, Button, Icon } from './ui';

/** Which conversation is shown: `id` undefined means "the most recent one", null means "start a new one". */
export interface ChatThread { kind: ChatKind; id: string | null | undefined }

const errorText = (error: unknown, fallback: string): string => error instanceof Error ? error.message : fallback;
const HUMAN_POLL_MS = 5000;

export type AiRequestState = 'idle' | 'responding' | 'connected' | 'error' | 'stopped';
const requestLabels: Record<AiRequestState, string> = {
  idle: 'Idle', responding: 'Thinking / Working', connected: 'Connected', error: 'AI unavailable', stopped: 'Stopped',
};

/** Same messages in the same order, so a background refresh can leave the screen untouched. */
function sameMessages(a: ChatMessage[] | null, b: ChatMessage[]): boolean {
  return a !== null && a.length === b.length && a.every((m, i) => m.id === b[i].id && m.content === b[i].content);
}

export function Conversation({ large = false, humanOnly = false, privateOnly = false, startNew = false, thread, onThreadChange, onRequestStateChange, children }: {
  children?: ReactNode; large?: boolean; humanOnly?: boolean; privateOnly?: boolean;
  /** Begin with a new conversation instead of the latest one (e.g. a message started from the call screen). */
  startNew?: boolean;
  /** Controlled thread selection (the chat page's history list); otherwise the component tracks it itself. */
  thread?: ChatThread; onThreadChange?: (thread: ChatThread) => void;
  onRequestStateChange?: (state: AiRequestState) => void;
}): ReactNode {
  const { snapshot, role, mode, busy: caseBusy, run } = useRelay();
  const caseId=mode==='server'?snapshot?.id ?? '':LIVE_CASE_ID;
  const [params] = useSearchParams();
  const requestedAudience = params.get('audience');
  const initialKind: ChatKind = mode !== 'server' && !privateOnly && (humanOnly || requestedAudience === 'human') ? 'human' : 'ai';
  const [ownThread, setOwnThread] = useState<ChatThread>({ kind: initialKind, id: startNew ? null : undefined });
  const active = thread ?? ownThread;
  const kind: ChatKind = mode === 'server' ? 'ai' : privateOnly ? 'ai' : humanOnly ? 'human' : active.kind;
  const advisorLocal = role === 'advisor' && kind === 'ai';
  const setThread = (next: ChatThread): void => { if (onThreadChange) onThreadChange(next); else setOwnThread(next); };
  const { chats, error: chatsError } = useChats(kind, role, caseId, !advisorLocal && Boolean(caseId));
  const conversationId = advisorLocal ? null : active.id === undefined ? chats?.[0]?.id ?? null : active.id;
  const scope = advisorLocal ? 'advisor-local' : `${caseId}:${kind}:${conversationId ?? 'new'}`;
  // The thread on screen right now, so a reply that finishes after the user switches chats doesn't overwrite it.
  const shownScope = useRef(scope);
  shownScope.current = scope;

  const [text, setText] = useDraft(`message:${snapshot?.id}:${scope}`);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [loadedScope, setLoadedScope] = useState('');
  const visibleMessages = loadedScope === scope ? messages : null;
  // The message just sent, shown until the saved copy comes back from the backend.
  const [pending, setPending] = useState<{ scope: string; message: ChatMessage } | null>(null);
  const [sending, setSending] = useState(false);
  const [requestState, setRequestState] = useState<AiRequestState>('idle');
  const updateRequestState = (state: AiRequestState): void => { setRequestState(state); onRequestStateChange?.(state); };
  // Live AI reply being streamed, and the conversation it belongs to.
  const [streaming, setStreaming] = useState<{ conversationId: string; text: string } | null>(null);
  const [chatErrorState, setChatErrorState] = useState<{ scope: string; text: string } | null>(null);
  const chatError = chatErrorState?.scope === scope ? chatErrorState.text : null;
  const setChatError = (text: string | null, targetScope = shownScope.current): void => setChatErrorState(text ? { scope: targetScope, text } : null);
  const [preview, setPreview] = useState(false);
  const stream = useRef<AbortController | null>(null);
  // Files picked with the paperclip: uploaded to the case documents right away, then sent with the next message.
  const [files, setFiles] = useState<{ key: string; name: string; id?: string; failed?: boolean }[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const reload = useCaseReload();
  const [poll, setPoll] = useState(0);
  // Messages of chats already opened, so switching back shows them instantly instead of a loading state.
  const cache = useRef(new Map<string, ChatMessage[]>());
  const loadGeneration = useRef(0);
  const choosingLatest = active.id === undefined;

  useEffect(() => { if (mode !== 'server' && !privateOnly && requestedAudience === 'human') setOwnThread({ kind: 'human', id: undefined }); }, [requestedAudience, privateOnly, mode]);
  useEffect(() => () => stream.current?.abort(), []);
  // Links like /founder/chat#message-main jump straight to the composer.
  const location = useLocation();
  useEffect(() => {
    if (!snapshot || (choosingLatest && chats === null) || chatsError) return;
    if (location.hash !== `#message-${large ? 'main' : 'side'}`) return;
    const composer = document.getElementById(`message-${large ? 'main' : 'side'}`);
    composer?.focus();
    composer?.scrollIntoView?.({ block: 'center' });
  }, [location, large, snapshot, choosingLatest, chats, chatsError]);
  useEffect(() => {
    setMessages(conversationId ? cache.current.get(conversationId) ?? null : []);
    setLoadedScope(scope);
    setFiles([]);
    setPreview(false);
  }, [conversationId, scope]);
  useEffect(() => {
    if (!conversationId) { setMessages([]); return; }
    const c = new AbortController();
    const generation = ++loadGeneration.current;
    listChatMessages(caseId, conversationId, role, c.signal).then(next => {
      if (c.signal.aborted || generation !== loadGeneration.current) return;
      cache.current.set(conversationId, next);
      setMessages(prev => sameMessages(prev, next) ? prev : next);
    })
      .catch((error: unknown) => { if (!c.signal.aborted && generation === loadGeneration.current) setChatError(errorText(error, 'Messages could not be loaded.')); });
    return () => c.abort();
  }, [conversationId, role, caseId, reload, poll]);
  // Pick up the other person's replies while a human conversation is open.
  useEffect(() => {
    if (kind !== 'human' || !conversationId) return;
    const timer = window.setInterval(() => setPoll(n => n + 1), HUMAN_POLL_MS);
    return () => window.clearInterval(timer);
  }, [kind, conversationId]);
  // Grow the composer with its content, like other chat inputs (CSS caps the height).
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = input.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }, [text]);
  // Scroll only when there's something new: jump to the end when a chat opens, glide down when a message
  // arrives, and follow a streaming reply unless the reader has scrolled up.
  const list = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<{ id: string | null; count: number }>({ id: null, count: 0 });
  const visiblePending = pending?.scope === scope ? pending.message : null;
  const itemCount = (visibleMessages?.length ?? 0) + (visiblePending ? 1 : 0) + (streaming?.conversationId === conversationId ? 1 : 0);
  const streamingText = streaming?.text;
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const before = scrolledFor.current;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (before.id !== conversationId || before.count === 0) el.scrollTop = el.scrollHeight;
    else if (itemCount > before.count) el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    else if (streamingText !== undefined && nearBottom) el.scrollTop = el.scrollHeight;
    scrolledFor.current = { id: conversationId, count: itemCount };
  }, [conversationId, itemCount, streamingText]);

  if (!snapshot) return null;
  const me = role === 'founder' ? snapshot.founder : snapshot.advisors[0];
  const other = role === 'founder' ? snapshot.advisors[0] : snapshot.founder;
  const showTabs = mode !== 'server' && !humanOnly && !privateOnly;
  const tabsId = `audience-${large ? 'main' : 'side'}`;
  const inputId = `message-${large ? 'main' : 'side'}`;
  const replying = streaming !== null;
  const busy = sending || replying || (choosingLatest && (chats === null || Boolean(chatsError))) || (advisorLocal && caseBusy);
  const uploadingFiles = files.some(f => !f.id && !f.failed);
  const readyFiles: ChatFile[] = files.flatMap(f => f.id ? [{ id: f.id, name: f.name }] : []);
  const syncedSources = mode === 'server' ? snapshot.sources.filter(source => source.cloud_status === 'synced') : [];
  const localNotes: ChatMessage[] = advisorLocal ? snapshot.messages.filter(message => message.audience.kind === 'private_ai' && message.author.id === me.id).map(message => ({
    id: message.id, conversation_id: 'local', case_id: caseId, sender_type: 'advisor', content: message.text, files: [], created_at: message.created_at,
  })) : [];
  const shown = advisorLocal ? localNotes : [...(visibleMessages ?? []), ...(visiblePending ? [visiblePending] : [])];

  const addFiles = (picked: File[]): void => {
    if (mode === 'server' || kind === 'ai' && role !== 'founder') return;
    const targetScope = scope;
    setPreview(false);
    const room = Math.max(5 - files.length, 0);
    if (picked.length > room) setChatError('You can attach up to 5 files per message.');
    for (const file of picked.slice(0, room)) {
      const key = crypto.randomUUID();
      setFiles(prev => [...prev, { key, name: file.name }]);
      void uploadDocument(caseId, file).then(doc => { setFiles(prev => prev.map(f => f.key === key ? { ...f, id: doc.id } : f)); announceCaseUpdate(); },
        (error: unknown) => { setFiles(prev => prev.map(f => f.key === key ? { ...f, failed: true } : f)); setChatError(`${file.name}: ${errorText(error, 'upload failed')}`, targetScope); });
    }
  };

  const openFile = async (documentId: string): Promise<void> => {
    const targetScope = scope;
    // Open the tab inside the click so popup blockers allow it, then point it at the signed S3 link.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try { const url = await documentUrl(documentId); if (tab) tab.location.href = url; else window.location.assign(url); }
    catch (error) { tab?.close(); setChatError(errorText(error, 'The file could not be opened.'), targetScope); }
  };

  // Streams the AI reply. The backend records the prompt before streaming and may save a partial reply on stop.
  const reply = async (id: string, prompt: string, documentIds: string[]): Promise<{ stopped: boolean }> => {
    const c = new AbortController();
    stream.current = c;
    let partial = '';
    setStreaming({ conversationId: id, text: '' });
    try {
      await streamChat(`conv-${id}`, prompt, chunk => { partial += chunk; setStreaming({ conversationId: id, text: partial }); },
        { signal: c.signal, documentIds, caseId: caseId, conversationId: id });
      return { stopped: false };
    } catch (error) {
      if (c.signal.aborted) return { stopped: true };
      throw error;
    } finally {
      if (stream.current === c) stream.current = null;
    }
  };

  const send = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault();
    const content = text.trim();
    if (!content || busy || uploadingFiles) return;
    if (advisorLocal) {
      const saved = await run({ kind: 'message', expected_revision: snapshot.revision, text: content, attachments: [], audience: { kind: 'private_ai' }, confirmed: false }, { silent: true });
      if (saved) setText('');
      else setChatError('The private note could not be saved.');
      return;
    }
    if (kind === 'human' && !preview) { setPreview(true); return; }
    const sentFiles = readyFiles;
    const knownMessages = new Set(visibleMessages?.map(message => message.id) ?? []);
    setChatError(null);
    setPreview(false);
    setSending(true);
    loadGeneration.current += 1;
    setPending({ scope, message: { id: 'pending', conversation_id: conversationId ?? '', case_id: caseId, sender_type: role, content, files: sentFiles, created_at: new Date().toISOString() } });
    let id = conversationId;
    let accepted = false;
    let failure: unknown = null;
    let refreshFailure = false;
    try {
      if (!id) {
        // A human chat is created with its first message; an AI chat gets it through the reply stream.
        id = (await createChat(caseId, kind, role, kind === 'human' ? { content, files: sentFiles } : undefined)).id;
        writeDraft(`${role}:message:${snapshot.id}:${caseId}:${kind}:${id}`, content);
        setPending(prev => prev ? { ...prev, scope: `${caseId}:${kind}:${id}` } : prev);
        setThread({ kind, id });
        if (kind === 'human') accepted = true;
      } else if (kind === 'human') {
        await sendChatMessage(caseId, id, role, content, sentFiles);
        accepted = true;
      }
      if (kind === 'ai') {
        updateRequestState('responding');
        const result = await reply(id, content, sentFiles.map(f => f.id));
        updateRequestState(result.stopped ? 'stopped' : 'connected');
        if (result.stopped) setChatError('Reply stopped. A partial answer may appear after the conversation refreshes.', `${caseId}:${kind}:${id}`);
        else accepted = true;
      }
    } catch (error) {
      failure = error;
      if (kind === 'ai') updateRequestState('error');
    } finally {
      // A failed response can follow a committed write. Reconcile before restoring a draft.
      if (id) {
        const generation = ++loadGeneration.current;
        try {
          const saved = await listChatMessages(caseId, id, role);
          cache.current.set(id, saved);
          if (generation === loadGeneration.current && shownScope.current === `${caseId}:${kind}:${id}`) { setMessages(saved); setLoadedScope(`${caseId}:${kind}:${id}`); }
          if (saved.some(message => message.sender_type === role && message.content === content && !knownMessages.has(message.id))) accepted = true;
        } catch {
          refreshFailure = true;
        }
      }
      if (accepted) {
        setText('');
        if (id) writeDraft(`${role}:message:${snapshot.id}:${caseId}:${kind}:${id}`, '');
        setFiles([]);
      }
      if (failure) setChatError(accepted
          ? errorText(failure, 'The assistant could not reply.')
          : `${errorText(failure, 'The message could not be sent.')} Check the conversation before trying again.`, `${caseId}:${kind}:${id ?? 'new'}`);
      else if (refreshFailure) setChatError('The conversation could not be refreshed. Check it before trying again.', `${caseId}:${kind}:${id ?? 'new'}`);
      setPending(null);
      setStreaming(null);
      setSending(false);
      // Refreshes chat histories, recent-message previews, checklist and activity.
      announceCaseUpdate();
    }
  };

  const authorName = (m: ChatMessage): string => m.sender_type === 'ai' ? 'Relay assistant' : m.sender_type === role ? me.name : other.name;

  return <section className={`panel conversation ${large ? 'conversation-large' : ''}`} aria-label="Conversation">
    {kind === 'ai' && !humanOnly && <AgentStatus state={advisorLocal ? 'Local notes' : requestLabels[requestState]}/>}
    {showTabs && <div className="audience-control"><Tabs id={tabsId} label="Message audience" items={[{ id: 'ai', label: 'AI assistant' }, { id: 'human', label: other.name }]} value={kind} onChange={value => { if (!busy) setThread({ kind: value as ChatKind, id: undefined }); }}/></div>}
    <div className="message-list" ref={list} aria-live="polite" {...(showTabs ? { role: 'tabpanel', id: `${tabsId}-${kind}-panel`, 'aria-labelledby': `${tabsId}-${kind}-tab` } : {})}>
      {kind === 'ai' && children}
      {chatsError && <p className="feedback feedback-error" role="alert">{chatsError}</p>}
      {choosingLatest && chats === null ? <p className="muted" role="status">Loading conversations…</p>
        : visibleMessages === null && conversationId && !visiblePending && !replying ? <p className="muted" role="status">Loading messages…</p>
        : shown.length === 0 && !replying ? <p className="muted">{advisorLocal ? 'Private notes saved in this browser.' : kind === 'ai' ? 'Ask Relay anything about your packet.' : `Start a conversation with ${other.name}.`}</p>
        : shown.map(m => <article key={m.id} className={`message ${m.sender_type === role ? 'own-message' : ''} ${m.sender_type === 'ai' ? 'ai-message' : ''}`}>
          <div className="message-author">{m.sender_type === 'ai' && <Icon name="agent" size={24}/>}<strong>{authorName(m)}</strong><small>{m.sender_type === 'ai' ? 'AI' : 'Human'} · {new Date(m.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</small></div>
          {m.files.length > 0 && <div className="message-files">{m.files.map(f => <button type="button" className="file-chip" key={f.id} onClick={() => { void openFile(f.id); }}><Icon name="file" size={16}/><span className="file-chip-name">{f.name}</span></button>)}</div>}
          <div className="message-bubble">{m.sender_type === 'ai' ? <MarkdownText text={m.content}/> : m.content}</div>
        </article>)}
      {streaming && streaming.conversationId === conversationId && <article className="message ai-message" aria-busy="true"><div className="message-author"><Icon name="agent" size={24}/><strong>Relay assistant</strong><small>AI · replying…</small></div><div className="message-bubble">{streaming.text ? <MarkdownText text={streaming.text}/> : <span className="typing" aria-label="Relay is replying"><span/><span/><span/></span>}</div></article>}
    </div>
    {preview && kind === 'human' && <div className="confirm-panel">
      <h3>Preview message to {other.name}</h3>
      <p>{text.trim()}</p>
      {readyFiles.length > 0 && <ul>{readyFiles.map(file => <li key={file.id}>{file.name}</li>)}</ul>}
      <p className="muted">This message and the listed files will be saved in the shared conversation.</p>
      <Button variant="outline" onClick={() => setPreview(false)} disabled={busy}>Keep editing</Button>
    </div>}
    {chatError && <p className="feedback feedback-error" role="alert">{chatError}</p>}
    <form className="composer" onSubmit={e => { void send(e); }}>
      <label className="sr-only" htmlFor={inputId}>Message {kind === 'human' ? other.name : 'Relay'}</label>
      {files.length > 0 && <div className="composer-files">{files.map(f => <span className={`file-chip ${f.failed ? 'is-failed' : ''}`} key={f.key}><Icon name="file" size={16}/><span className="file-chip-name">{f.name}</span>{!f.id && !f.failed && <small>Uploading…</small>}{f.failed && <small>Failed</small>}<button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(prev => prev.filter(item => item.key !== f.key))}>×</button></span>)}</div>}
      <textarea ref={input} rows={1} id={inputId} value={text} maxLength={8000} placeholder={kind === 'human' ? `Message ${other.name}…` : advisorLocal ? 'Write a private note…' : 'Ask Relay or answer a question…'} disabled={busy}
        onChange={e => { setText(e.target.value); setPreview(false); }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}/>
      <div className="composer-actions">
        {mode === 'server' && role === 'founder' && <>
          <select aria-label="Attach synced source" value="" disabled={busy || files.length >= 5 || syncedSources.length === 0} onChange={event => {
            const source = syncedSources.find(item => item.id === event.target.value);
            if (source && !files.some(file => file.id === source.id)) setFiles(previous => [...previous, { key: crypto.randomUUID(), id: source.id, name: source.name }]);
          }}>
            <option value="">Attach source</option>
            {syncedSources.filter(source => !files.some(file => file.id === source.id)).map(source => <option key={source.id} value={source.id}>{source.name}</option>)}
          </select>
          <Link to="/founder/home" className="composer-upload-link">Upload on Home</Link>
        </>}
        {mode !== 'server' && (kind === 'human' || role === 'founder') && <button type="button" className="composer-attach" aria-label="Add file" title="Add file" onClick={() => fileInput.current?.click()} disabled={busy || files.length >= 5}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>}
        {mode !== 'server' && <input ref={fileInput} type="file" multiple hidden accept=".pdf,.csv,.doc,.docx,.xls,.xlsx,.html,.txt,.md,.png,.jpg,.jpeg,.gif,.webp" onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}/>}
        {replying
          ? <Button variant="outline" aria-label="Stop" onClick={() => stream.current?.abort()}>{large ? <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/></svg> : 'Stop'}</Button>
          : <Button type="submit" aria-label={kind === 'human' ? undefined : 'Send'} disabled={busy || uploadingFiles || !text.trim()}>{kind === 'human' ? (preview ? 'Confirm send' : 'Preview message') : large ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg> : 'Send'}</Button>}
      </div>
    </form>
    <p className="conversation-footnote">{kind === 'human' ? <><Badge>Shared</Badge> Saved and visible to {other.name}.</> : advisorLocal ? <><Badge>Local notes</Badge> Saved in this browser. For grounded advisor AI, <Link to="/advisor/clients?advisor_demo=server">open the server synthetic workspace</Link>.</> : <><Badge>Live AI</Badge> Replies come from Relay&apos;s assistant on Bedrock.</>}</p>
  </section>;
}
