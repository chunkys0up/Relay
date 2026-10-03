import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, CaseSidebar, Conversation, ScreenState, plainText, timeAgo, useChats, useRelay } from '@relay/shared';
import type { AiRequestState } from '@relay/shared';
import type { ChatThread } from '../../../frontend-shared/src/conversation';
import './styles.css';

const requestLabels: Record<AiRequestState, string> = { idle: 'Idle', responding: 'Thinking / Working', connected: 'Connected', error: 'AI unavailable', stopped: 'Stopped' };

function DemoScreen() {
  const [requestState, setRequestState] = useState<AiRequestState>('idle');
  const { snapshot, role, mode } = useRelay();
  const [params] = useSearchParams();
  const [thread, setThread] = useState<ChatThread>({ kind: mode !== 'server' && params.get('audience') === 'human' ? 'human' : 'ai', id: undefined });
  const caseId=mode==='server'?snapshot?.id ?? '':undefined;
  const activeKind = mode === 'server' ? 'ai' : thread.kind;
  const { chats, error: chatsError } = useChats(activeKind, role, caseId, mode!=='server'||snapshot?.server_legacy_sync_status==='synced');
  const activeId = thread.id === undefined ? chats?.[0]?.id ?? null : thread.id;
  const otherName = role === 'founder' ? snapshot?.advisors[0]?.name : snapshot?.founder.name;
  const sentClarification = snapshot?.clarifications.find((question) => question.packet_version_id === snapshot.current_packet_version_id && question.status === 'sent');

  return <ScreenState>{snapshot && <div className="founder-chat">
    <nav className="founder-chat-history" aria-label="Chat history">
      <div className="founder-chat-history-head">
        <h2>{activeKind === 'ai' ? 'Chats with Relay' : `Chats with ${otherName ?? 'your advisor'}`}</h2>
        <button type="button" className="founder-chat-new" onClick={() => setThread({ kind: thread.kind, id: null })} aria-pressed={activeId === null}>+ New chat</button>
      </div>
      {chatsError ? <p className="founder-chat-history-empty" role="alert">{chatsError}</p>
        : chats === null ? <p className="founder-chat-history-empty" role="status">Loading chats…</p>
        : chats.length === 0 ? <p className="founder-chat-history-empty">No chats yet. Your conversations will be listed here.</p>
        : <ul>{chats.map(chat => <li key={chat.id}><button type="button" aria-current={chat.id === activeId ? 'true' : undefined} onClick={() => setThread({ kind: thread.kind, id: chat.id })}>
            <strong>{chat.title}</strong>
            {chat.last_content && <span>{plainText(chat.last_content)}</span>}
            <small>{timeAgo(chat.updated_at)}</small>
          </button></li>)}</ul>}
    </nav>
    <div className="founder-chat-main">
      <header className="founder-chat-header">
        <div><h1>AI Chat</h1><p>Prepare your packet with Relay</p></div>
        <div aria-label="AI request status"><small>AI request</small> <Badge tone={requestState === 'error' ? 'attention' : requestState === 'connected' ? 'success' : 'neutral'}>{requestLabels[requestState]}</Badge></div>
      </header>
      <div className="founder-chat-conversation">
        {chats && chats.length > 0 && <label className="founder-chat-history-select">Chat<select value={activeId ?? ''} onChange={e => setThread({ kind: thread.kind, id: e.target.value || null })}><option value="">New chat</option>{chats.map(chat => <option key={chat.id} value={chat.id}>{chat.title}</option>)}</select></label>}
        <Conversation large privateOnly={mode==='server'} onRequestStateChange={setRequestState} thread={thread} onThreadChange={setThread}>
      {mode !== 'server' && sentClarification && <section className="founder-chat-clarification" aria-label="Advisor question"><p>{snapshot.advisors[0]?.name ?? 'Your advisor'} sent you a question about your packet.</p><Link className="founder-chat-action" to="/founder/home/clarification">Answer the question</Link></section>}
</Conversation>
      </div>
    </div>
    <CaseSidebar/>
  </div>}</ScreenState>;
}

export default function Screen() {
  const {snapshot,mode}=useRelay();
  if(mode==='server' && snapshot?.server_legacy_sync_status!=='synced')return <section className="founder-chat"><div className="founder-chat-main"><header className="founder-chat-header"><h1>AI Chat</h1></header><p role="status">This packet case has not synced to the chat service. Chat is unavailable for this case until backend sync succeeds.</p></div></section>;
  return <DemoScreen />;
}
