import { useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useRelay } from './context';
import { Conversation } from './conversation';
import type { ChatThread } from './conversation';
import { plainText, timeAgo, useChats } from './live';
import type { ChatKind } from './relayApi';
import './chatPage.css';

/**
 * A full-height chat screen: saved chats on the left, the open conversation in the middle,
 * and an optional sidebar on the right. `humanOnly` limits it to chats with the other person.
 */
export function ChatPage({ title, subtitle, humanOnly = false, newLabel = '+ New chat', aside, children }: {
  title: string; subtitle: string; humanOnly?: boolean; newLabel?: string; aside?: ReactNode; children?: ReactNode;
}): ReactNode {
  const { snapshot, role } = useRelay();
  const [params] = useSearchParams();
  const [thread, setThread] = useState<ChatThread>({ kind: humanOnly || params.get('audience') === 'human' ? 'human' : 'ai', id: undefined });
  const { chats, error: chatsError } = useChats(thread.kind, role);
  const activeId = thread.id === undefined ? chats?.[0]?.id ?? null : thread.id;
  const otherName = role === 'founder' ? snapshot?.advisors[0]?.name : snapshot?.founder.name;
  const open = (kind: ChatKind, id: string | null): void => setThread({ kind, id });

  return <div className="chat-page">
    <nav className="chat-page-history" aria-label="Chat history">
      <div className="chat-page-history-head">
        <h2>{thread.kind === 'ai' ? 'Chats with Relay' : `Chats with ${otherName ?? (role === 'founder' ? 'your advisor' : 'your client')}`}</h2>
        <button type="button" className="chat-page-new" onClick={() => open(thread.kind, null)} aria-pressed={activeId === null}>{newLabel}</button>
      </div>
      {chatsError ? <p className="chat-page-history-empty" role="alert">{chatsError}</p>
        : chats === null ? <p className="chat-page-history-empty" role="status">Loading chats…</p>
        : chats.length === 0 ? <p className="chat-page-history-empty">No chats yet. Your conversations will be listed here.</p>
        : <ul>{chats.map(chat => <li key={chat.id}><button type="button" aria-current={chat.id === activeId ? 'true' : undefined} onClick={() => open(thread.kind, chat.id)}>
            <strong>{chat.title}</strong>
            {chat.last_content && <span>{plainText(chat.last_content)}</span>}
            <small>{timeAgo(chat.updated_at)}</small>
          </button></li>)}</ul>}
    </nav>
    <div className="chat-page-main">
      <header className="chat-page-header">
        <div><h1>{title}</h1><p>{subtitle}</p></div>
      </header>
      <div className="chat-page-conversation">
        {chats && chats.length > 0 && <label className="chat-page-history-select">Chat<select value={activeId ?? ''} onChange={e => open(thread.kind, e.target.value || null)}><option value="">New chat</option>{chats.map(chat => <option key={chat.id} value={chat.id}>{chat.title}</option>)}</select></label>}
        <Conversation large humanOnly={humanOnly} thread={thread} onThreadChange={setThread}>{children}</Conversation>
      </div>
    </div>
    {aside}
  </div>;
}
