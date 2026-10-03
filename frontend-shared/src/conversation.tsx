import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import type { FormEvent, ReactNode } from 'react';
import { useDraft, useRelay } from './context';
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
const initials = (name: string): string => name.split(/\s+/).slice(0, 2).map(part => part[0] ?? '').join('').toUpperCase();

/** Same messages in the same order, so a background refresh can leave the screen untouched. */
function sameMessages(a: ChatMessage[] | null, b: ChatMessage[]): boolean {
  return a !== null && a.length === b.length && a.every((m, i) => m.id === b[i].id && m.content === b[i].content);
}

export function Conversation({ large = false, humanOnly = false, privateOnly = false, startNew = false, thread, onThreadChange, children }: {
  children?: ReactNode; large?: boolean; humanOnly?: boolean; privateOnly?: boolean;
  /** Begin with a new conversation instead of the latest one (e.g. a message started from the call screen). */
  startNew?: boolean;
  /** Controlled thread selection (the chat page's history list); otherwise the component tracks it itself. */
  thread?: ChatThread; onThreadChange?: (thread: ChatThread) => void;
}): ReactNode {
  const { snapshot, role } = useRelay();
  const [params] = useSearchParams();
  const initialKind: ChatKind = !privateOnly && (humanOnly || params.get('audience') === 'human') ? 'human' : 'ai';
  const [ownThread, setOwnThread] = useState<ChatThread>({ kind: initialKind, id: startNew ? null : undefined });
  const active = thread ?? ownThread;
  const kind = active.kind;
  const setThread = (next: ChatThread): void => { if (onThreadChange) onThreadChange(next); else setOwnThread(next); };
  const { chats } = useChats(kind, role);
  const conversationId = active.id === undefined ? chats?.[0]?.id ?? null : active.id;
  // The thread on screen right now, so a reply that finishes after the user switches chats doesn't overwrite it.
  const shownId = useRef(conversationId);
  shownId.current = conversationId;

  const [text, setText] = useDraft('message:' + snapshot?.id + ':' + kind);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  // The message just sent, shown until the saved copy comes back from the backend.
  const [pending, setPending] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  // Live AI reply being streamed, and the conversation it belongs to.
  const [streaming, setStreaming] = useState<{ conversationId: string; text: string } | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const stream = useRef<AbortController | null>(null);
  // Files picked with the paperclip: uploaded to the case documents right away, then sent with the next message.
  const [files, setFiles] = useState<{ key: string; name: string; id?: string; failed?: boolean }[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const reload = useCaseReload();
  const [poll, setPoll] = useState(0);
  // Messages of chats already opened, so switching back shows them instantly instead of a loading state.
  const cache = useRef(new Map<string, ChatMessage[]>());

  useEffect(() => { if (!privateOnly && params.get('audience') === 'human') setOwnThread({ kind: 'human', id: undefined }); }, [params, privateOnly]);
  useEffect(() => () => stream.current?.abort(), []);
  // Links like /founder/chat#message-main jump straight to the composer.
  const location = useLocation();
  useEffect(() => {
    if (location.hash !== `#message-${large ? 'main' : 'side'}`) return;
    const composer = document.getElementById(`message-${large ? 'main' : 'side'}`);
    composer?.focus();
    composer?.scrollIntoView?.({ block: 'center' });
  }, [location, large]);
  useEffect(() => { setMessages(conversationId ? cache.current.get(conversationId) ?? null : []); setChatError(null); }, [conversationId]);
  useEffect(() => {
    if (!conversationId) { setMessages([]); return; }
    const c = new AbortController();
    listChatMessages(LIVE_CASE_ID, conversationId, role, c.signal).then(next => { cache.current.set(conversationId, next); setMessages(prev => sameMessages(prev, next) ? prev : next); })
      .catch((error: unknown) => { if (!c.signal.aborted) setChatError(errorText(error, 'Messages could not be loaded.')); });
    return () => c.abort();
  }, [conversationId, role, reload, poll]);
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
  const itemCount = (messages?.length ?? 0) + (pending ? 1 : 0) + (streaming?.conversationId === conversationId ? 1 : 0);
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
  const showTabs = !humanOnly && !privateOnly;
  const tabsId = `audience-${large ? 'main' : 'side'}`;
  const inputId = `message-${large ? 'main' : 'side'}`;
  const replying = streaming !== null;
  const busy = sending || replying;
  const uploadingFiles = files.some(f => !f.id && !f.failed);
  const readyFiles: ChatFile[] = files.flatMap(f => f.id ? [{ id: f.id, name: f.name }] : []);
  const shown = [...(messages ?? []), ...(pending ? [pending] : [])];

  const addFiles = (picked: File[]): void => {
    const room = Math.max(5 - files.length, 0);
    if (picked.length > room) setChatError('You can attach up to 5 files per message.');
    for (const file of picked.slice(0, room)) {
      const key = crypto.randomUUID();
      setFiles(prev => [...prev, { key, name: file.name }]);
      void uploadDocument(LIVE_CASE_ID, file).then(doc => { setFiles(prev => prev.map(f => f.key === key ? { ...f, id: doc.id } : f)); announceCaseUpdate(); },
        (error: unknown) => { setFiles(prev => prev.map(f => f.key === key ? { ...f, failed: true } : f)); setChatError(`${file.name}: ${errorText(error, 'upload failed')}`); });
    }
  };

  const openFile = async (documentId: string): Promise<void> => {
    // Open the tab inside the click so popup blockers allow it, then point it at the signed S3 link.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try { const url = await documentUrl(documentId); if (tab) tab.location.href = url; else window.location.assign(url); }
    catch (error) { tab?.close(); setChatError(errorText(error, 'The file could not be opened.')); }
  };

  // Streams the AI reply. The streamed text stays on screen until send() swaps in the saved copy.
  const reply = async (id: string, prompt: string, documentIds: string[]): Promise<{ text: string; stopped: boolean }> => {
    const c = new AbortController();
    stream.current = c;
    let partial = '';
    setStreaming({ conversationId: id, text: '' });
    try {
      await streamChat(`conv-${id}`, prompt, chunk => { partial += chunk; setStreaming({ conversationId: id, text: partial }); },
        { signal: c.signal, documentIds, caseId: LIVE_CASE_ID, conversationId: id });
      return { text: partial, stopped: false };
    } catch (error) {
      if (c.signal.aborted) return { text: partial, stopped: true };
      throw error;
    } finally {
      if (stream.current === c) stream.current = null;
    }
  };

  const send = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault();
    const content = text.trim();
    if (!content || busy || uploadingFiles) return;
    const sentFiles = readyFiles;
    setChatError(null);
    setSending(true);
    setPending({ id: 'pending', conversation_id: conversationId ?? '', case_id: LIVE_CASE_ID, sender_type: role, content, files: sentFiles, created_at: new Date().toISOString() });
    setText('');
    setFiles([]);
    let id = conversationId;
    try {
      if (!id) {
        // A human chat is created with its first message; an AI chat gets it through the reply stream.
        id = (await createChat(LIVE_CASE_ID, kind, role, kind === 'human' ? { content, files: sentFiles } : undefined)).id;
        setThread({ kind, id });
      } else if (kind === 'human') {
        await sendChatMessage(LIVE_CASE_ID, id, role, content, sentFiles);
      }
      const result = kind === 'ai' ? await reply(id, content, sentFiles.map(f => f.id)) : null;
      let saved = await listChatMessages(LIVE_CASE_ID, id, role);
      // A stopped reply is saved in the background; keep showing it until the saved copy arrives.
      if (result?.stopped && result.text.trim() && saved.at(-1)?.sender_type !== 'ai') {
        saved = [...saved, { id: 'stopped-reply', conversation_id: id, case_id: LIVE_CASE_ID, sender_type: 'ai', content: result.text.trim(), files: [], created_at: new Date().toISOString() }];
      }
      cache.current.set(id, saved);
      if (shownId.current === id) setMessages(saved);
      // No saved reply means the AI service failed; the stream's text carries the reason.
      if (result && !result.stopped && saved.at(-1)?.sender_type !== 'ai') {
        setChatError(result.text.trim() || 'Relay didn\'t send a reply. Try again.');
      }
    } catch (error) {
      setChatError(errorText(error, 'The message could not be sent.'));
      setText(content);
    } finally {
      // Cleared together with the saved messages above, so nothing blinks out in between.
      setPending(null);
      setStreaming(null);
      setSending(false);
      // Refreshes chat histories, recent-message previews, checklist and activity.
      announceCaseUpdate();
    }
  };

  const authorName = (m: ChatMessage): string => m.sender_type === 'ai' ? 'Relay assistant' : m.sender_type === role ? me.name : other.name;

  return <section className={`panel conversation ${large ? 'conversation-large' : ''}`} aria-label="Conversation">
    {kind === 'ai' && !humanOnly && <AgentStatus/>}
    {showTabs && <div className="audience-control"><Tabs id={tabsId} label="Message audience" items={[{ id: 'ai', label: 'AI assistant' }, { id: 'human', label: other.name }]} value={kind} onChange={value => { if (!busy) setThread({ kind: value as ChatKind, id: undefined }); }}/></div>}
    <div className="message-list" ref={list} aria-live="polite" {...(showTabs ? { role: 'tabpanel', id: `${tabsId}-${kind}-panel`, 'aria-labelledby': `${tabsId}-${kind}-tab` } : {})}>
      {kind === 'ai' && children}
      {messages === null && conversationId && !pending && !replying ? <p className="muted" role="status">Loading messages…</p>
        : shown.length === 0 && !replying ? <p className="muted">{kind === 'ai' ? 'Ask Relay anything about your packet.' : `Start a conversation with ${other.name}.`}</p>
        : shown.map(m => <article key={m.id} className={`message ${m.sender_type === role ? 'own-message' : 'other-message'} ${m.sender_type === 'ai' ? 'ai-message' : ''}`}>
          <div className="message-author">{m.sender_type === 'ai' ? <Icon name="agent" size={24}/> : m.sender_type !== role && <span className="message-avatar" aria-hidden="true">{initials(authorName(m))}</span>}<strong>{authorName(m)}</strong><small>{m.sender_type === 'ai' ? 'AI' : 'Human'} · {new Date(m.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</small></div>
          {m.files.length > 0 && <div className="message-files">{m.files.map(f => <button type="button" className="file-chip" key={f.id} onClick={() => { void openFile(f.id); }}><Icon name="file" size={16}/><span className="file-chip-name">{f.name}</span></button>)}</div>}
          <div className="message-bubble">{m.sender_type === 'ai' ? <MarkdownText text={m.content}/> : m.content}</div>
        </article>)}
      {streaming && streaming.conversationId === conversationId && <article className="message other-message ai-message" aria-busy="true"><div className="message-author"><Icon name="agent" size={24}/><strong>Relay assistant</strong><small>AI · replying…</small></div><div className="message-bubble">{streaming.text ? <MarkdownText text={streaming.text}/> : <span className="typing" aria-label="Relay is replying"><span/><span/><span/></span>}</div></article>}
    </div>
    {chatError && <p className="feedback feedback-error" role="alert">{chatError}</p>}
    <form className="composer" onSubmit={e => { void send(e); }}>
      <label className="sr-only" htmlFor={inputId}>Message {kind === 'human' ? other.name : 'Relay'}</label>
      {files.length > 0 && <div className="composer-files">{files.map(f => <span className={`file-chip ${f.failed ? 'is-failed' : ''}`} key={f.key}><Icon name="file" size={16}/><span className="file-chip-name">{f.name}</span>{!f.id && !f.failed && <small>Uploading…</small>}{f.failed && <small>Failed</small>}<button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(prev => prev.filter(item => item.key !== f.key))}>×</button></span>)}</div>}
      <textarea ref={input} rows={1} id={inputId} value={text} maxLength={8000} placeholder={kind === 'human' ? `Message ${other.name}…` : 'Ask Relay or answer a question…'} disabled={busy}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}/>
      <div className="composer-actions">
        <button type="button" className="composer-attach" aria-label="Add file" title="Add file" onClick={() => fileInput.current?.click()} disabled={busy || files.length >= 5}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
        <input ref={fileInput} type="file" multiple hidden accept=".pdf,.csv,.doc,.docx,.xls,.xlsx,.html,.txt,.md,.png,.jpg,.jpeg,.gif,.webp" onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}/>
        {replying
          ? <Button variant="outline" aria-label="Stop" onClick={() => stream.current?.abort()}>{large ? <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/></svg> : 'Stop'}</Button>
          : <Button type="submit" aria-label="Send" disabled={busy || uploadingFiles || !text.trim()}>{large ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg> : 'Send'}</Button>}
      </div>
    </form>
    <p className="conversation-footnote">{kind === 'human' ? <><Badge>Shared</Badge> Saved and visible to {other.name}.</> : <><Badge>Live AI</Badge> Replies come from Relay&apos;s assistant on Bedrock.</>}</p>
  </section>;
}
