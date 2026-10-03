import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Conversation } from './conversation';
import { RelayProvider, adapter } from './context';
import { LIVE_CASE_ID } from './relayApi';

const json = (data: unknown): Response => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const documentId = '00000000-0000-4000-8000-000000000055';

beforeEach(() => adapter.reset());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(role: 'founder' | 'advisor', privateOnly = false): void {
  render(<MemoryRouter initialEntries={[`/${role}/chat?audience=human`]}><RelayProvider role={role}><Conversation privateOnly={privateOnly}/></RelayProvider></MemoryRouter>);
}

describe('private AI and human file selection', () => {
  it('keeps advisor AI notes local and out of the human audience', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    mount('advisor', true);
    expect(await screen.findByRole('textbox', { name: 'Message Relay' })).toBeVisible();
    expect(screen.queryByRole('tablist', { name: 'Message audience' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message Alex Morgan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add file' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Relay' }), { target: { value: 'Private review note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Private review note')).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await adapter.snapshot('advisor')).data.messages.find(message => message.text === 'Private review note')?.audience.kind).toBe('private_ai');
    expect(screen.getByRole('link', { name: 'open the server synthetic workspace' })).toHaveAttribute('href', '/advisor/clients?advisor_demo=server');
  });

  it('drops selected private AI files when switching to a human conversation', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async input => {
      const url = String(input);
      if (url.includes('/conversations?')) return json([]);
      if (url.endsWith('/documents/upload')) return json({ id: documentId, case_id: LIVE_CASE_ID, filename: 'private.pdf' });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const view = render(<MemoryRouter initialEntries={['/founder/chat']}><RelayProvider role="founder"><Conversation/></RelayProvider></MemoryRouter>);
    await screen.findByRole('textbox', { name: 'Message Relay' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add file' })).toBeEnabled());
    fireEvent.change(view.container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['private'], 'private.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(screen.getByText('private.pdf')).toBeVisible());
    await waitFor(() => expect(screen.queryByText('Uploading…')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'Maya Chen' }));
    expect(await screen.findByRole('textbox', { name: 'Message Maya Chen' })).toBeVisible();
    expect(screen.queryByText('private.pdf')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'AI assistant' }));
    expect(screen.queryByText('private.pdf')).not.toBeInTheDocument();
  });

  it('shows the recipient and selected file before saving a human message', async () => {
    let submitted: { kind: string; message: { content: string; files: { id: string; name: string }[] } } | null = null;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/conversations?')) return json([]);
      if (url.endsWith('/documents/upload')) return json({ id: documentId, case_id: LIVE_CASE_ID, filename: 'plan.pdf' });
      if (url.endsWith('/conversations') && init?.method === 'POST') {
        submitted = JSON.parse(String(init.body)) as typeof submitted;
        return json({ id: '00000000-0000-4000-8000-000000000099' });
      }
      if (url.includes('/messages?')) return json([{ id: 'message-1', conversation_id: '00000000-0000-4000-8000-000000000099', case_id: LIVE_CASE_ID, sender_type: 'founder', content: 'Please review the plan.', files: [{ id: documentId, name: 'plan.pdf' }], created_at: '2026-10-03T12:00:00Z' }]);
      throw new Error(`Unexpected request: ${url}`);
    }));
    const view = render(<MemoryRouter initialEntries={['/founder/chat?audience=human']}><RelayProvider role="founder"><Conversation/></RelayProvider></MemoryRouter>);
    const composer = await screen.findByRole('textbox', { name: 'Message Maya Chen' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add file' })).toBeEnabled());
    fireEvent.change(view.container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['plan'], 'plan.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(screen.queryByText('Uploading…')).not.toBeInTheDocument());
    fireEvent.change(composer, { target: { value: 'Please review the plan.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview message' }));
    const preview = await screen.findByRole('heading', { name: 'Preview message to Maya Chen' });
    expect(preview.parentElement).toHaveTextContent('plan.pdf');
    expect(submitted).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm send' }));
    await waitFor(() => expect(submitted).toMatchObject({ kind: 'human', message: { content: 'Please review the plan.', files: [{ id: documentId, name: 'plan.pdf' }] } }));
  });
});
