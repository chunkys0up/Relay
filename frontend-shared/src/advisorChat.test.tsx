import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { RelayProvider } from './context';
import { AdvisorChat } from './advisorChat';
import type { AdvisorConversation, AdvisorSession } from './advisorApi';

const version = { id: 'packet-1', version: 1, hash: 'a'.repeat(64), title: 'Planning packet', source_ids: ['source-1'] };
const session: AdvisorSession = {
  mode: 'synthetic', provider: 'bedrock', csrf_token: 'csrf',
  workspace: { case_id: 'case-1', company: 'Northstar Labs', advisor: { id: 'advisor-1', name: 'Taylor' }, versions: [version] },
};
const empty: AdvisorConversation = { conversation_id: 'conversation-1', case_id: 'case-1', versions: [{ id: version.id, hash: version.hash }], messages: [] };
const answer: AdvisorConversation = {
  ...empty,
  messages: [
    { id: 'user-1', role: 'user', text: 'What conflicts?', created_at: '2026-10-02T00:00:00Z', citations: [] },
    { id: 'answer-1', role: 'assistant', text: 'Intake says $240,000; forecast says $280,000. Confirm the actual figure.', kind: 'conflict', created_at: '2026-10-02T00:00:01Z', citations: [{ source_id: 'source-1', source_hash: 'b'.repeat(64), version_id: version.id, label: 'Founder intake', field: 'annual_revenue', url: `/api/advisor/cases/case-1/sources/source-1/preview?version_id=packet-1&packet_hash=${version.hash}&source_hash=${'b'.repeat(64)}` }], draft_questions: ['Which revenue figure is final?'] },
  ],
};
const keyedAnswer = (key: string): AdvisorConversation => ({ ...answer, messages: answer.messages.map(message => ({ ...message, request_key: key })) });

function response(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status }); }

function mount() {
  return render(<MemoryRouter initialEntries={['/advisor/clients']}><RelayProvider role="advisor"><AdvisorChat selectedPacketId="packet-1"/></RelayProvider></MemoryRouter>);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); localStorage.clear(); });

describe('server advisor chat', () => {
  it('requires explicit server context and renders a grounded reply with scoped citation and editable private draft', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/advisor/session') return response(session);
      if (url.includes('/conversations?')) return response({ items: [] });
      if (url.endsWith('/conversations') && init?.method === 'POST') return response(empty);
      if (url.endsWith('/messages')) return response(keyedAnswer((init?.headers as Record<string, string>)['Idempotency-Key']));
      throw new Error(`Unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    mount();
    expect(await screen.findByText(/The document preview is a browser demo/)).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /Ask about shared packet/ })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Open server synthetic advisor workspace' }));
    expect(await screen.findByText(/No private messages for this server packet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Compare shared versions' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /Ask about shared packet/ }), 'What conflicts?');
    await user.click(screen.getByRole('button', { name: 'Ask advisor AI' }));
    expect(await screen.findByText(/Intake says \$240,000/)).toBeTruthy();
    const citation = screen.getByRole('link', { name: /Founder intake/ });
    expect(citation.getAttribute('href')).toContain('/api/advisor/cases/case-1/sources/source-1/preview');
    const draft = screen.getByRole('textbox', { name: 'Private follow-up draft' });
    await user.clear(draft);
    await user.type(draft, 'Please confirm revenue.');
    expect(draft).toHaveValue('Please confirm revenue.');
    expect(screen.getByText(/Nothing is sent to a client/)).toBeTruthy();
  });

  it('retries a failed request with the original idempotency key and one server history', async () => {
    let sends = 0;
    const keys: string[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/advisor/session') return response(session);
      if (url.includes('/conversations?')) return response({ items: [] });
      if (url.endsWith('/conversations') && init?.method === 'POST') return response(empty);
      if (url.endsWith('/messages')) {
        sends += 1;
        keys.push((init?.headers as Record<string, string>)['Idempotency-Key']);
        if (sends === 1) return response({ error: { code: 'MODEL_UNAVAILABLE', message: 'Model unavailable', retryable: true } }, 503);
        return response(keyedAnswer((init?.headers as Record<string, string>)['Idempotency-Key']));
      }
      throw new Error(`Unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Open server synthetic advisor workspace' }));
    await screen.findByText(/No private messages for this server packet/);
    await user.type(screen.getByRole('textbox', { name: /Ask about shared packet/ }), 'What conflicts?');
    await user.click(screen.getByRole('button', { name: 'Ask advisor AI' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Model unavailable');
    await user.click(screen.getByRole('button', { name: 'Retry request' }));
    await waitFor(() => expect(screen.getAllByText(/Intake says \$240,000/)).toHaveLength(1));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('does not treat another tab’s answer as completion of an interrupted request', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/advisor/session') return response(session);
      if (url.includes('/conversations?')) return response({ items: [] });
      if (url.endsWith('/conversations') && init?.method === 'POST') return response(empty);
      if (url.endsWith('/messages')) return response({ error: { code: 'MODEL_UNAVAILABLE', message: 'Model unavailable', retryable: true } }, 503);
      if (url.endsWith('/conversation-1')) return response(keyedAnswer('another-tab-request'));
      throw new Error(`Unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Open server synthetic advisor workspace' }));
    await screen.findByText(/No private messages for this server packet/);
    await user.type(screen.getByRole('textbox', { name: /Ask about shared packet/ }), 'What conflicts?');
    await user.click(screen.getByRole('button', { name: 'Ask advisor AI' }));
    await screen.findByRole('button', { name: 'Retry request' });
    await user.click(screen.getByRole('button', { name: 'Refresh history' }));
    expect(await screen.findByRole('button', { name: 'Retry request' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /Ask about shared packet/ })).toBeDisabled();
  });

  it('unlocks editing after a terminal rejection', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/advisor/session') return response(session);
      if (url.includes('/conversations?')) return response({ items: [] });
      if (url.endsWith('/conversations') && init?.method === 'POST') return response(empty);
      if (url.endsWith('/messages')) return response({ error: { code: 'INVALID_QUESTION', message: 'INVALID_QUESTION', retryable: false } }, 400);
      throw new Error(`Unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Open server synthetic advisor workspace' }));
    await screen.findByText(/No private messages for this server packet/);
    await user.type(screen.getByRole('textbox', { name: /Ask about shared packet/ }), 'Question');
    await user.click(screen.getByRole('button', { name: 'Ask advisor AI' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('INVALID_QUESTION');
    expect(screen.queryByRole('button', { name: 'Retry request' })).toBeNull();
    expect(screen.getByRole('textbox', { name: /Ask about shared packet/ })).not.toBeDisabled();
  });
});
