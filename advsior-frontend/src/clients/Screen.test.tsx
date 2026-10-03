import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { RelayProvider, adapter } from '@relay/shared';
import Screen from './Screen';

beforeEach(() => adapter.reset());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const conversationId = '00000000-0000-4000-8000-000000000099';
const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function mockHumanService(): { messages: { content: string }[]; fetchMock: ReturnType<typeof vi.fn<typeof fetch>> } {
  const messages: { id: string; conversation_id: string; case_id: string; sender_type: 'advisor'; content: string; files: never[]; created_at: string }[] = [];
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes('/conversations?')) return json(messages.length ? [{ id: conversationId, kind: 'human', title: 'Client message' }] : []);
    if (url.endsWith('/conversations') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { message: { content: string } };
      messages.push({ id: `message-${messages.length + 1}`, conversation_id: conversationId, case_id: '22222222-2222-2222-2222-222222222222', sender_type: 'advisor', content: body.message.content, files: [], created_at: '2026-10-03T12:00:00Z' });
      return json({ id: conversationId }, 201);
    }
    if (url.includes(`/conversations/${conversationId}/messages?`)) return json(messages);
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { messages, fetchMock };
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{location.search}{location.hash}</output>;
}

function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><RelayProvider role="advisor"><LocationProbe/><Routes><Route path="/advisor/clients" element={<Screen/>}/></Routes></RelayProvider></MemoryRouter>);
}

describe('advisor clients', () => {
  it('honors a source citation query and previews the shared original', async () => {
    mount('/advisor/clients?source=00000000-0000-4000-8000-000000000011');
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeTruthy();
    expect((await screen.findAllByText('Founder intake.pdf')).length).toBeGreaterThan(1);
    expect(await screen.findByText(/2026 annual revenue: \$240,000/)).toBeTruthy();
  });

  it('searches shared filenames and never lists unassigned workspaces', async () => {
    mount('/advisor/clients?q=Founder%20intake');
    expect((await screen.findAllByText('Founder intake.pdf')).length).toBeGreaterThan(1);
    expect(await screen.findByText(/2026 annual revenue: \$240,000/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Cedar Studio')).toBeNull());
  });

  it('offers a clear path when a query has no assigned match', async () => {
    mount('/advisor/clients?q=unassigned');
    expect(await screen.findByText('No matching assigned client')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Cedar Studio')).toBeNull());
  });

  it('opens named client messages while preserving the selected source and private drafts', async () => {
    mockHumanService();
    mount('/advisor/clients?source=00000000-0000-4000-8000-000000000011&q=Northstar');
    expect(await screen.findByText(/2026 annual revenue: \$240,000/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Messages' }));
    expect(screen.getByRole('heading', { name: 'Messages with Alex Morgan' })).toBeVisible();
    expect(screen.getByLabelText('Current route')).toHaveTextContent('source=00000000-0000-4000-8000-000000000011');
    expect(screen.getByLabelText('Current route')).toHaveTextContent('q=Northstar');
    expect(screen.getByLabelText('Current route')).toHaveTextContent('audience=human#message-side');
    expect(screen.getByText(/2026 annual revenue: \$240,000/)).toBeVisible();
    const composer = screen.getByRole('textbox', { name: 'Message Alex Morgan' });
    await waitFor(() => expect(composer).toHaveFocus());
    fireEvent.change(composer, { target: { value: 'Please review our question.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Private AI' }));
    expect(screen.queryByRole('textbox', { name: 'Message Alex Morgan' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message Relay' })).not.toHaveValue('Please review our question.');
    fireEvent.click(screen.getByRole('button', { name: 'Messages' }));
    expect(screen.getByRole('textbox', { name: 'Message Alex Morgan' })).toHaveValue('Please review our question.');
    expect((await adapter.snapshot('founder')).data.messages.some(message => message.text === 'Please review our question.')).toBe(false);
  });

  it('requires preview and confirmation before a client message is persisted', async () => {
    const service = mockHumanService();
    mount('/advisor/clients?audience=human#message-side');
    const composer = await screen.findByRole('textbox', { name: 'Message Alex Morgan' });
    await waitFor(() => expect(composer).toBeEnabled());
    fireEvent.change(composer, { target: { value: 'Can we discuss the updated packet?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview message' }));
    expect(screen.getByRole('heading', { name: 'Preview message to Alex Morgan' })).toBeVisible();
    expect(service.messages).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm send' }));
    await waitFor(() => expect(service.messages.map(message => message.content)).toEqual(['Can we discuss the updated packet?']));
    expect(await screen.findByText('Can we discuss the updated packet?')).toBeVisible();
    cleanup();
    mount('/advisor/clients?audience=human#message-side');
    expect(await screen.findByText('Can we discuss the updated packet?')).toBeVisible();
    expect(service.fetchMock.mock.calls.some(([input]) => String(input).includes(`/conversations/${conversationId}/messages?role=advisor`))).toBe(true);
  });

  it('keeps the server advisor selection while opening a separate browser client message', async () => {
    mount('/advisor/clients?advisor_demo=server&server_version=selected-version&q=Northstar');
    fireEvent.click(await screen.findByRole('button', { name: 'Messages' }));
    const route = screen.getByLabelText('Current route');
    expect(route).toHaveTextContent('advisor_demo=server');
    expect(route).toHaveTextContent('server_version=selected-version');
    expect(route).toHaveTextContent('q=Northstar');
    expect(screen.getByRole('heading', { name: 'Messages with Alex Morgan' })).toBeVisible();
    expect(screen.getByText(/Server advisor AI and its drafts stay private/)).toBeVisible();
  });
});
