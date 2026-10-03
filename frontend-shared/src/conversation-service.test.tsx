import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Conversation } from './conversation';
import { RelayProvider, adapter } from './context';
import { LIVE_CASE_ID } from './relayApi';
import type { ChatMessage } from './relayApi';

const conversationId = '00000000-0000-4000-8000-000000000099';
const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
let messageSequence = 0;
const saved = (sender_type: ChatMessage['sender_type'], content: string): ChatMessage => ({
  id: `00000000-0000-4000-8000-${String(++messageSequence).padStart(12, '0')}`,
  conversation_id: conversationId, case_id: LIVE_CASE_ID, sender_type, content, files: [], created_at: '2026-10-03T12:00:00Z',
});

beforeEach(() => { adapter.reset(); messageSequence = 0; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(role: 'founder' | 'advisor' = 'founder', route = '/founder/chat'): void {
  render(<MemoryRouter initialEntries={[route]}><RelayProvider role={role}><Conversation/></RelayProvider></MemoryRouter>);
}

async function compose(text: string, label = 'Message Relay'): Promise<void> {
  fireEvent.change(await screen.findByRole('textbox', { name: label }), { target: { value: text } });
}

describe('persisted conversation sends', () => {
  it('streams a founder AI reply and displays the saved service messages', async () => {
    const messages: ChatMessage[] = [];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/conversations?')) return json([]);
      if (url.endsWith('/conversations') && init?.method === 'POST') return json({ id: conversationId }, 201);
      if (url.endsWith('/chat/stream')) {
        const body = JSON.parse(String(init?.body)) as { message: string; conversation_id: string };
        expect(body.conversation_id).toBe(conversationId);
        messages.push(saved('founder', body.message), saved('ai', 'First second.'));
        return new Response('First second.');
      }
      if (url.endsWith(`/conversations/${conversationId}/messages?role=founder`)) return json(messages);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    mount();
    await compose('What is next?');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('First second.')).toBeVisible();
    expect(await screen.findByText('Connected')).toBeVisible();
    expect(await screen.findByText('What is next?')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/chat/stream'), expect.objectContaining({ method: 'POST' }));
    expect((await adapter.snapshot('founder')).data.messages.some(message => message.text === 'What is next?')).toBe(false);
  });

  it('reconciles a failed AI stream with the prompt already saved by the service', async () => {
    const messages: ChatMessage[] = [];
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/conversations?')) return json([]);
      if (url.endsWith('/conversations') && init?.method === 'POST') return json({ id: conversationId }, 201);
      if (url.endsWith('/chat/stream')) {
        const body = JSON.parse(String(init?.body)) as { message: string };
        messages.push(saved('founder', body.message));
        return new Response('   ');
      }
      if (url.includes(`/conversations/${conversationId}/messages?`)) return json(messages);
      throw new Error(`Unexpected request: ${url}`);
    }));
    mount();
    await compose('What is next?');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('empty reply');
    expect(await screen.findByText('What is next?')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Message Relay' })).toHaveValue('');
    expect(screen.queryByText('Relay assistant', { selector: '.message-author strong' })).not.toBeInTheDocument();
  });

  it('keeps an unsent draft visible when a newly created AI chat rejects the prompt', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/conversations?')) return json([]);
      if (url.endsWith('/conversations') && init?.method === 'POST') return json({ id: conversationId }, 201);
      if (url.endsWith('/chat/stream')) return json({ detail: 'Assistant unavailable before save' }, 503);
      if (url.includes(`/conversations/${conversationId}/messages?`)) return json([]);
      throw new Error(`Unexpected request: ${url}`);
    }));
    mount();
    await compose('Keep this draft');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Assistant unavailable before save');
    expect(screen.getByRole('textbox', { name: 'Message Relay' })).toHaveValue('Keep this draft');
  });

  it('previews a human message before the service saves it', async () => {
    const messages: ChatMessage[] = [];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/conversations?')) return json([]);
      if (url.endsWith('/conversations') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { kind: string; message: { content: string } };
        expect(body.kind).toBe('human');
        messages.push(saved('founder', body.message.content));
        return json({ id: conversationId }, 201);
      }
      if (url.includes(`/conversations/${conversationId}/messages?`)) return json(messages);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    mount('founder', '/founder/chat?audience=human');
    await compose('Please review this.', 'Message Maya Chen');
    fireEvent.click(screen.getByRole('button', { name: 'Preview message' }));
    expect(await screen.findByRole('heading', { name: 'Preview message to Maya Chen' })).toBeVisible();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm send' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message Maya Chen' })).toHaveValue(''));
    expect(await screen.findByText('Please review this.')).toBeVisible();
    expect((await adapter.snapshot('advisor')).data.messages.some(message => message.text === 'Please review this.')).toBe(false);
  });
});
