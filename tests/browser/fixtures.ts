import { test as base, expect } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import type { ActivityEntry, ChatFile, ChatKind, ChatMessage, ChatRole, ChatSummary, ChecklistItem } from '../../frontend-shared/src/relayApi';

export interface FixtureDocument {
  id: string;
  case_id: string;
  filename: string;
  s3_key: string;
  uploaded_at: string;
}
export interface DocumentApiState {
  documents: FixtureDocument[];
  checklist: ChecklistItem[];
  activity: ActivityEntry[];
  chatRequests: { message: string; session_id: string; case_id?: string; document_ids?: string[]; conversation_id?: string }[];
  conversations: ChatSummary[];
  messages: ChatMessage[];
  uploads: { filename: string; body: Buffer; content: Buffer }[];
}

/** Intercept the legacy document service, including popup previews, without AWS or a running backend. */
export async function installDocumentApi(context: BrowserContext): Promise<DocumentApiState> {
  const state: DocumentApiState = { documents: [], uploads: [], checklist: [], activity: [], chatRequests: [], conversations: [], messages: [] };
  const previews = new Map<string, Buffer>();
  let nextChatId = 1;
  const chatId = (): string => `00000000-0000-4000-a000-${String(nextChatId++).padStart(12, '0')}`;
  const addMessage = (chat: ChatSummary, sender: ChatMessage['sender_type'], content: string, files: ChatFile[] = []): ChatMessage => {
    const created_at = new Date().toISOString();
    const message: ChatMessage = { id: chatId(), conversation_id: chat.id, case_id: chat.case_id, sender_type: sender, content, files, created_at };
    state.messages.push(message);
    chat.last_sender = sender;
    chat.last_content = content;
    chat.last_at = created_at;
    chat.updated_at = created_at;
    return message;
  };
  const visible = (chat: ChatSummary, role: ChatRole): boolean => chat.kind === 'human' || chat.owner_role === role;
  const chatHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' };
  await context.route('**/api/cases/*/conversations**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split('/');
    const caseId = parts[3];
    const conversationId = parts[5];
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers: chatHeaders, json: body });
    if (method === 'OPTIONS') { await route.fulfill({ status: 204, headers: chatHeaders }); return; }
    if (!conversationId) {
      if (method === 'GET') {
        const kind = url.searchParams.get('kind');
        const role = url.searchParams.get('role') as ChatRole;
        await json(state.conversations.filter(chat => chat.case_id === caseId && chat.kind === kind && visible(chat, role)).reverse());
      } else if (method === 'POST') {
        const body = request.postDataJSON() as { kind: ChatKind; role: ChatRole; message?: { role: ChatRole; content: string; files: ChatFile[] } };
        const now = new Date().toISOString();
        const chat: ChatSummary = { id: chatId(), case_id: caseId, kind: body.kind, owner_role: body.kind === 'ai' ? body.role : null,
          title: body.message?.content.slice(0, 60) ?? 'New chat', created_at: now, updated_at: now, last_sender: null, last_content: null, last_at: null };
        state.conversations.push(chat);
        if (body.message) addMessage(chat, body.message.role, body.message.content, body.message.files);
        await json(chat, 201);
      } else await json({ detail: 'Unsupported method' }, 405);
      return;
    }
    const chat = state.conversations.find(item => item.id === conversationId && item.case_id === caseId);
    const role = (url.searchParams.get('role') ?? (method === 'POST' ? (request.postDataJSON() as { role: ChatRole }).role : 'founder')) as ChatRole;
    if (!chat || !visible(chat, role)) { await json({ detail: 'conversation not found' }, 404); return; }
    if (parts[6] === 'messages') {
      if (method === 'GET') await json(state.messages.filter(message => message.conversation_id === chat.id));
      else if (method === 'POST' && chat.kind === 'human') {
        const body = request.postDataJSON() as { role: ChatRole; content: string; files: ChatFile[] };
        await json(addMessage(chat, body.role, body.content, body.files), 201);
      } else await json({ detail: 'Unsupported message request' }, 400);
    } else await json({ detail: 'Unknown conversation route' }, 404);
  });
  await context.route('**/api/cases/*/messages/recent**', async route => {
    const url = new URL(route.request().url());
    const role = url.searchParams.get('role') as ChatRole;
    const limit = Number(url.searchParams.get('limit') ?? 3);
    const allowed = new Set(state.conversations.filter(chat => chat.case_id === url.pathname.split('/')[3] && visible(chat, role)).map(chat => chat.id));
    await route.fulfill({ headers: chatHeaders, json: state.messages.filter(message => allowed.has(message.conversation_id)).slice(-limit).reverse() });
  });
  await context.route('**/api/documents**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' };
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    if (path === '/api/documents' && request.method() === 'GET') {
      const caseId = url.searchParams.get('case_id');
      if (!caseId) { await json({ detail: 'case_id is required' }, 422); return; }
      await json(state.documents.filter(doc => doc.case_id === caseId));
      return;
    }
    if (path === '/api/documents/upload' && request.method() === 'POST') {
      const body = request.postDataBuffer() ?? Buffer.alloc(0);
      const multipart = body.toString('latin1');
      const filename = multipart.match(/filename="([^"]+)"/)?.[1] ?? 'untitled';
      const fileHeader = multipart.indexOf('filename="');
      const contentStart = multipart.indexOf('\r\n\r\n', fileHeader) + 4;
      const boundary = request.headers()['content-type']?.match(/boundary=(?:"([^"]+)"|([^;]+))/);
      const contentEnd = body.indexOf(Buffer.from('\r\n--' + (boundary?.[1] ?? boundary?.[2] ?? '')), contentStart);
      const content = body.subarray(contentStart, contentEnd >= contentStart ? contentEnd : body.length);
      const caseId = multipart.match(/name="case_id"\r\n\r\n([^\r\n]+)/)?.[1];
      if (!caseId) { await json({ detail: 'case_id is required' }, 422); return; }
      const id = '00000000-0000-4000-9000-' + String(state.documents.length + 1).padStart(12, '0');
      const doc: FixtureDocument = { id, case_id: caseId, filename, s3_key: 'offline/' + id, uploaded_at: '2026-10-03T00:00:00Z' };
      state.uploads.push({ filename, body, content });
      state.documents.push(doc);
      previews.set(id, content);
      await json({ ...doc, source_id: id, bucket: 'offline-fixture', key: doc.s3_key, content_type: 'text/plain', size: content.length });
      return;
    }
    const selected = state.documents.find(doc => path === '/api/documents/' + doc.id + '/url' || path === '/api/documents/' + doc.id + '/preview');
    if (!selected) { await json({ detail: 'Offline document not found' }, 404); return; }
    if (path.endsWith('/url')) { await json({ url: 'http://127.0.0.1:8000/api/documents/' + selected.id + '/preview' }); return; }
    await route.fulfill({ headers, contentType: 'text/plain', body: previews.get(selected.id) ?? Buffer.from(selected.filename) });
  });
  await context.route('**/api/cases/*/checklist**', async route => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS', 'Access-Control-Allow-Headers': '*' };
    const request = route.request();
    const parts = new URL(request.url()).pathname.split('/');
    const caseId = parts[3];
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    if (request.method() === 'PATCH') {
      const item = state.checklist.find(entry => entry.id === parts[5] && entry.case_id === caseId);
      if (!item) { await route.fulfill({ status: 404, headers, json: { detail: 'Offline checklist item not found' } }); return; }
      item.state = (request.postDataJSON() as { state: ChecklistItem['state'] }).state;
      await route.fulfill({ headers, json: item });
      return;
    }
    await route.fulfill({ headers, json: state.checklist.filter(item => item.case_id === caseId) });
  });
  await context.route('**/api/cases/*/activity**', async route => {
    const headers = { 'Access-Control-Allow-Origin': '*' };
    const url = new URL(route.request().url());
    const caseId = url.pathname.split('/')[3];
    const limit = Number(url.searchParams.get('limit') ?? 20);
    await route.fulfill({ headers, json: state.activity.filter(entry => entry.case_id === caseId).slice(0, limit) });
  });
  await context.route('**/api/chat**', async route => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': '*' };
    if (['DELETE', 'OPTIONS'].includes(route.request().method())) {
      await route.fulfill({ status: 204, headers });
      return;
    }
    if (route.request().method() === 'POST' && new URL(route.request().url()).pathname === '/api/chat/stream') {
      const chatRequest = route.request().postDataJSON() as DocumentApiState['chatRequests'][number];
      state.chatRequests.push(chatRequest);
      const chat = state.conversations.find(item => item.id === chatRequest.conversation_id);
      if (chat) {
        addMessage(chat, chat.owner_role ?? 'founder', chatRequest.message);
        addMessage(chat, 'ai', 'Offline model reply for this browser test.');
      }
      await route.fulfill({ headers, contentType: 'text/plain', body: 'Offline model reply for this browser test.' });
      return;
    }
    await route.fulfill({ status: 503, headers, contentType: 'application/json',
      body: JSON.stringify({ detail: 'Unexpected live assistant route in offline browser tests.' }) });
  });
  await context.route('**/api/workflow/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'GET' && path === '/api/workflow/session') {
      await route.fulfill({ json: { csrf_token: 'offline-workflow-token', demo: true, mode: 'unconfigured', provider: 'Offline browser fixture' } });
    } else if (route.request().method() === 'GET' && path === '/api/workflow/cases') {
      await route.fulfill({ json: { items: [] } });
    } else {
      await route.fulfill({ status: 503, json: { error: { code: 'OFFLINE_FIXTURE', message: 'Packet workflow unavailable in generic browser tests.', retryable: true } } });
    }
  });
  await context.route('**/api/advisor/**', route => route.fulfill({
    status: 503, headers: { 'Access-Control-Allow-Origin': '*' },
    json: { error: { code: 'OFFLINE_FIXTURE', message: 'Advisor service is not enabled in this browser fixture.', retryable: true } },
  }));
  return state;
}

export const test = base.extend<{ documentsApi: DocumentApiState }>({
  documentsApi: [async ({ context }, use) => { await use(await installDocumentApi(context)); }, { auto: true }],
});
export { expect };
