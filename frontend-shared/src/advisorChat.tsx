import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  advisorApi, advisorCitationHref, advisorPacketHref, AdvisorApiError,
} from './advisorApi';
import type { AdvisorConversation, AdvisorMessage, AdvisorSession, AdvisorVersion } from './advisorApi';
import './advisorChat.css';

interface PendingSubmission { key: string; text: string; conversationId: string }
const pendingKey = (context: string): string => `advisor-pending:${context}`;

function savedPending(context: string, conversationId: string): PendingSubmission | null {
  const raw = sessionStorage.getItem(pendingKey(context));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingSubmission>;
    return value.conversationId === conversationId && typeof value.key === 'string' && typeof value.text === 'string' && value.text.length <= 2000
      ? value as PendingSubmission : null;
  } catch { return null; }
}

function errorMessage(error: unknown): string {
  if (error instanceof AdvisorApiError) return error.message;
  if (error instanceof Error && error.name === 'AbortError') return 'The request was interrupted. Refresh history or retry with the same request ID.';
  return error instanceof Error ? error.message : 'Advisor request failed.';
}

function isConversation(value: AdvisorConversation, caseId: string, versions: AdvisorVersion[]): boolean {
  return value.case_id === caseId
    && Array.isArray(value.messages)
    && value.versions.length === versions.length
    && versions.every(version => value.versions.some(item => item.id === version.id && item.hash === version.hash));
}

function creationKey(caseId: string, versions: AdvisorVersion[]): string {
  const key = `advisor-create:${caseId}:${versions.map(item => `${item.id}:${item.hash}`).join(':')}`;
  let value = sessionStorage.getItem(key);
  if (!value) { value = crypto.randomUUID(); sessionStorage.setItem(key, value); }
  return value;
}

function DraftQuestion({ id, text }: { id: string; text: string }): ReactNode {
  const key = `advisor-private-draft:${id}`;
  const [draft, setDraft] = useState(() => localStorage.getItem(key) ?? text);
  function edit(value: string): void { localStorage.setItem(key, value); setDraft(value); }
  return <label className="advisor-draft-question">Private follow-up draft
    <textarea value={draft} onChange={event => edit(event.currentTarget.value)} aria-label="Private follow-up draft"/>
    <small>Editable in this browser. Nothing is sent to a client.</small>
  </label>;
}

function Message({ message, session, versions }: { message: AdvisorMessage; session: AdvisorSession; versions: AdvisorVersion[] }): ReactNode {
  return <article className={`advisor-chat-message ${message.role === 'user' ? 'is-own' : ''}`}>
    <strong>{message.role === 'user' ? 'You' : 'Relay advisor AI'}</strong>
    {message.kind && message.role === 'assistant' && <small className="advisor-answer-kind">{message.kind.replaceAll('_', ' ')}</small>}
    <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</time>
    <p>{message.text}</p>
    {message.citations?.length > 0 && <div className="advisor-chat-citations" aria-label="Answer citations">
      {message.citations.map((citation, index) => {
        const href = advisorCitationHref(citation, session.workspace.case_id, versions);
        return href
          ? <a href={href} target="_blank" rel="noopener noreferrer" key={`${message.id}:${index}`}>{citation.label}{citation.page ? ` · p. ${citation.page}` : ''}{citation.field ? ` · ${citation.field}` : ''}</a>
          : <span key={`${message.id}:${index}`} className="advisor-citation-unavailable">Citation unavailable</span>;
      })}
    </div>}
    {message.role === 'assistant' && message.draft_questions?.map((question, index) => <DraftQuestion key={`${message.id}:${index}`} id={`${session.workspace.advisor.id}:${session.workspace.case_id}:${message.id}:${index}`} text={question}/>)}
  </article>;
}

/** This chat has its own server session. The browser fixture supplies no authority or evidence. */
export function AdvisorChat({ selectedPacketId, serverActive = false }: { selectedPacketId: string | null; serverActive?: boolean }): ReactNode {
  const [params, setParams] = useSearchParams();
  const active = serverActive || params.get('advisor_demo') === 'server';
  const [session, setSession] = useState<AdvisorSession | null>(null);
  const [conversation, setConversation] = useState<AdvisorConversation | null>(null);
  const [status, setStatus] = useState('Checking advisor server…');
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingRetry, setPendingRetry] = useState<PendingSubmission | null>(null);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  const activeContext = useRef('');

  useEffect(() => {
    const controller = new AbortController();
    setSession(null);
    setError(null);
    setStatus('Checking advisor server…');
    void advisorApi.session(controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (!result.workspace?.case_id || !Array.isArray(result.workspace.versions)) throw new Error('Advisor session has no authorized workspace.');
      setSession(result);
      setStatus('Advisor server connected');
    }).catch(reason => {
      if (controller.signal.aborted) return;
      setError(errorMessage(reason));
      setStatus('Advisor server unavailable');
    });
    return () => controller.abort();
  }, [sessionAttempt]);

  const serverVersions = session?.workspace.versions ?? [];
  const requestedVersionId = params.get('server_version');
  const selectedVersion = serverVersions.find(item => item.id === requestedVersionId)
    ?? (!active ? serverVersions.find(item => item.id === selectedPacketId) : null)
    ?? serverVersions.at(-1) ?? null;
  const comparison = serverVersions.find(item => item.id === params.get('compare_version') && item.id !== selectedVersion?.id) ?? null;
  const versions = useMemo(() => [selectedVersion, comparison].filter((item): item is AdvisorVersion => item !== null), [selectedVersion, comparison]);
  const contextKey = active && session && selectedVersion
    ? `${session.workspace.case_id}:${versions.map(item => `${item.id}:${item.hash}`).join(':')}` : '';

  useEffect(() => {
    request.current?.abort();
    activeContext.current = contextKey;
    setConversation(null);
    setPendingRetry(null);
    setSending(false);
    setError(null);
    if (!active || !session || !selectedVersion) return;
    const controller = new AbortController();
    request.current = controller;
    const caseId = session.workspace.case_id;
    setStatus('Loading private history…');
    void (async () => {
      const listed = await advisorApi.conversations(caseId, versions, controller.signal);
      const existing = listed.items.at(-1);
      const value = existing ?? await advisorApi.createConversation(caseId, versions, session.csrf_token, creationKey(caseId, versions), controller.signal);
      if (!isConversation(value, caseId, versions)) throw new Error('Advisor server returned a conversation for a different context.');
      if (!controller.signal.aborted && activeContext.current === contextKey) {
        setConversation(value);
        const pending = savedPending(contextKey, value.conversation_id);
        if (pending && !value.messages.some(item => item.role === 'assistant' && item.text.trim() && item.request_key === pending.key)) setPendingRetry(pending);
        else sessionStorage.removeItem(pendingKey(contextKey));
        setStatus('Connected · private history saved on server');
      }
    })().catch(reason => {
      if (!controller.signal.aborted && activeContext.current === contextKey) {
        setError(errorMessage(reason));
        setStatus('Advisor conversation unavailable');
      }
    });
    return () => controller.abort();
  }, [active, contextKey, session, selectedVersion, versions]);

  function updateContext(changes: Record<string, string | null>): void {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if ('server_version' in changes) next.delete('server_source');
    setParams(next);
  }

  async function send(value: string, retry?: PendingSubmission): Promise<void> {
    if (!session || !conversation || sending || !value.trim()) return;
    const current = retry ?? { key: crypto.randomUUID(), text: value.trim(), conversationId: conversation.conversation_id };
    if (current.conversationId !== conversation.conversation_id) return;
    const currentContext = activeContext.current;
    setPendingRetry(current);
    sessionStorage.setItem(pendingKey(currentContext), JSON.stringify(current));
    setSending(true);
    setError(null);
    setStatus('Asking advisor AI…');
    const controller = new AbortController();
    request.current = controller;
    try {
      const result = await advisorApi.send(session.workspace.case_id, conversation.conversation_id, current.text, session.csrf_token, current.key, controller.signal);
      if (!isConversation(result, session.workspace.case_id, versions)) throw new Error('Advisor server returned a reply for a different context.');
      if (controller.signal.aborted || activeContext.current !== currentContext) return;
      if (!result.messages.some(item => item.role === 'assistant' && item.text.trim() && item.request_key === current.key)) throw new Error('Advisor server returned no usable answer for this request.');
      setConversation(result);
      setText('');
      setPendingRetry(null);
      sessionStorage.removeItem(pendingKey(currentContext));
      setStatus('Connected · private history saved on server');
    } catch (reason) {
      if (activeContext.current !== currentContext) return;
      setError(errorMessage(reason));
      if (reason instanceof AdvisorApiError && !reason.retryable) {
        setPendingRetry(null);
        sessionStorage.removeItem(pendingKey(currentContext));
        setStatus('Request rejected · edit and try again');
      } else setStatus('Reply failed');
    } finally {
      if (activeContext.current === currentContext) setSending(false);
    }
  }

  async function refreshHistory(): Promise<void> {
    if (!session || !conversation || sending) return;
    const currentContext = activeContext.current;
    setStatus('Checking saved history…');
    setError(null);
    try {
      const result = await advisorApi.getConversation(session.workspace.case_id, conversation.conversation_id);
      if (!isConversation(result, session.workspace.case_id, versions)) throw new Error('Advisor server returned a conversation for a different context.');
      if (currentContext !== activeContext.current) return;
      setConversation(result);
      if (pendingRetry && result.messages.some(item => item.role === 'assistant' && item.text.trim() && item.request_key === pendingRetry.key)) {
        setPendingRetry(null);
        sessionStorage.removeItem(pendingKey(currentContext));
      }
      setStatus('Connected · private history saved on server');
    } catch (reason) {
      if (currentContext !== activeContext.current) return;
      setError(errorMessage(reason));
      setStatus('History unavailable');
    }
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!pendingRetry) void send(text);
  }

  return <section className="advisor-chat" aria-label="Server advisor AI conversation">
    <div className="advisor-chat-status" role="status">{status}</div>
    {error && <p className="advisor-chat-error" role="alert">{error}</p>}
    {error && <button type="button" onClick={() => setSessionAttempt(value => value + 1)}>Reconnect advisor server</button>}
    {!active
      ? <div className="advisor-chat-intro">
          <p>The document preview is a browser demo. Advisor AI uses a separate, server-owned synthetic workspace and its exact shared versions.</p>
          {session && serverVersions.length > 0 && <button type="button" onClick={() => updateContext({ advisor_demo: 'server', server_version: selectedVersion?.id ?? null })}>Open server synthetic advisor workspace</button>}
        </div>
      : session && selectedVersion
        ? <>
            <div className="advisor-chat-context">
              <strong>Server synthetic advisor workspace</strong>
              <span>{session.workspace.company} · {session.workspace.advisor.name}</span>
              <small>{session.mode === 'simulated' ? 'Simulated model · no AWS calls' : session.mode === 'live' ? 'Bedrock configured' : 'Model unavailable'} · {session.provider}</small>
              <label>Shared packet
                <select aria-label="Server shared packet" value={selectedVersion.id} onChange={event => updateContext({ server_version: event.currentTarget.value, compare_version: null })}>
                  {serverVersions.map(item => <option value={item.id} key={item.id}>{item.title} · v{item.version}</option>)}
                </select>
              </label>
              <small>Chat and the center preview use server packet v{selectedVersion.version} ({selectedVersion.hash.slice(0, 12)}…). Browser demo documents are separate.</small>
              <a href={advisorPacketHref(session.workspace.case_id, selectedVersion)} target="_blank" rel="noopener noreferrer">Open server packet v{selectedVersion.version}</a>
              {serverVersions.length > 1 && <label>Compare with
                <select aria-label="Compare shared version" value={comparison?.id ?? ''} onChange={event => updateContext({ compare_version: event.currentTarget.value || null })}>
                  <option value="">No comparison</option>
                  {serverVersions.filter(item => item.id !== selectedVersion.id).map(item => <option value={item.id} key={item.id}>v{item.version}</option>)}
                </select>
              </label>}
            </div>
            <div className="advisor-chat-shortcuts" aria-label="Grounded prompts">
              <button type="button" disabled={!conversation || sending || Boolean(pendingRetry)} onClick={() => { void send(`Summarize shared packet v${selectedVersion.version}. Cite the evidence and label unknowns.`); }}>Summarize packet</button>
              <button type="button" disabled={!conversation || sending || Boolean(pendingRetry)} onClick={() => { void send(`What evidence is missing or conflicting in shared packet v${selectedVersion.version}? Cite each source and distinguish unknowns.`); }}>Missing or conflicting evidence</button>
              <button type="button" disabled={!conversation || sending || !comparison || Boolean(pendingRetry)} onClick={() => { if (comparison) void send(`Compare shared packet v${selectedVersion.version} with v${comparison.version}. Cite both versions and identify changes, conflicts, and unknowns.`); }}>Compare shared versions</button>
              <button type="button" disabled={!conversation || sending || Boolean(pendingRetry)} onClick={() => { void send(`Draft private follow-up questions about missing or conflicting evidence in shared packet v${selectedVersion.version}. Cite the reasons.`); }}>Draft follow-up questions</button>
            </div>
            <div className="advisor-chat-history" aria-live="polite">
              {!conversation ? <p>Loading server conversation…</p>
                : conversation.messages.length === 0 ? <p>No private messages for this server packet yet.</p>
                  : conversation.messages.map(message => <Message key={message.id} message={message} session={session} versions={versions}/>)}
            </div>
            {pendingRetry && !sending && <div className="advisor-chat-retry">
              <p>The request may have finished on the server. Check history or retry using the same request ID.</p>
              <button type="button" onClick={() => { void refreshHistory(); }}>Refresh history</button>
              <button type="button" onClick={() => { void send(pendingRetry.text, pendingRetry); }}>Retry request</button>
            </div>}
            {sending && <button type="button" onClick={() => request.current?.abort()}>Stop waiting</button>}
            <form className="advisor-chat-composer" onSubmit={submit}>
              <label htmlFor="advisor-chat-question">Ask about shared packet v{selectedVersion.version}</label>
              <textarea id="advisor-chat-question" value={text} maxLength={2000} onChange={event => setText(event.currentTarget.value)} placeholder="Ask a question about the server shared evidence…" disabled={!conversation || sending || Boolean(pendingRetry)}/>
              <button type="submit" disabled={!conversation || sending || Boolean(pendingRetry) || !text.trim()}>Ask advisor AI</button>
            </form>
            <p className="advisor-chat-note">Private server history. Stopping the wait does not cancel server work. Follow-up drafts stay in this browser; no message is sent to a client.</p>
          </>
        : <p>The server has no shared packet available for this advisor.</p>}
  </section>;
}
