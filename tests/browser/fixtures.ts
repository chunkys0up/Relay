import { test as base, expect } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import type { ActivityEntry, ChecklistItem } from '../../frontend-shared/src/relayApi';

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
  chatRequests: { message: string; session_id: string; case_id?: string; document_ids?: string[] }[];
  uploads: { filename: string; body: Buffer; content: Buffer }[];
}

/** Intercept the legacy document service, including popup previews, without AWS or a running backend. */
export async function installDocumentApi(context: BrowserContext): Promise<DocumentApiState> {
  const state: DocumentApiState = { documents: [], uploads: [], checklist: [], activity: [], chatRequests: [] };
  const previews = new Map<string, Buffer>();
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
      state.chatRequests.push(route.request().postDataJSON() as DocumentApiState['chatRequests'][number]);
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
