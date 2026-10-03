import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Conversation } from './conversation';
import { RelayProvider, adapter } from './context';

beforeEach(() => adapter.reset());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(): void {
  render(<MemoryRouter initialEntries={['/founder/chat']}><RelayProvider role="founder"><Conversation/></RelayProvider></MemoryRouter>);
}

async function send(prompt: string): Promise<void> {
  fireEvent.change(await screen.findByRole('textbox', { name: 'Message Relay' }), { target: { value: prompt } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

function stream(parts: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (const part of parts) controller.enqueue(encoder.encode(part));
    controller.close();
  } }));
}

async function savedAiReplies(): Promise<string[]> {
  return (await adapter.snapshot('founder')).data.messages.filter(message => message.author.kind === 'ai').map(message => message.text);
}

describe('founder legacy assistant request', () => {
  it('saves a complete streamed reply and reports a completed request', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(stream(['First ', 'second.']));
    vi.stubGlobal('fetch', fetchMock);
    mount();
    expect(screen.queryByText('Live AI')).not.toBeInTheDocument();
    await send('What is next?');
    await waitFor(async () => expect(await savedAiReplies()).toEqual(['First second.']));
    expect(screen.getByText('First second.')).toBeVisible();
    expect(screen.getByText('The last reply completed through the legacy case assistant.')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/chat/stream'), expect.objectContaining({ method: 'POST' }));
  });

  it('reports an empty reply as a failure and never saves it as an AI answer', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(stream(['   '])));
    mount();
    await send('What is next?');
    expect(await screen.findByRole('alert')).toHaveTextContent('empty reply');
    expect(screen.getByText('The assistant request failed. Check the error above.')).toBeVisible();
    expect(await savedAiReplies()).toEqual([]);
  });

  it('discards partial text when streaming fails', async () => {
    const encoder = new TextEncoder();
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      if (reads++ === 0) controller.enqueue(encoder.encode('Incomplete'));
      else controller.error(new Error('Connection dropped'));
    } }))));
    mount();
    await send('What is next?');
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection dropped');
    expect(await savedAiReplies()).toEqual([]);
  });

  it('stops a partial stream without saving an answer', async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const response = new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(encoder.encode('Incomplete'));
        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError')));
      } }));
      return response;
    }));
    mount();
    await send('What is next?');
    expect(await screen.findByText('Incomplete')).toBeVisible();
    expect(screen.getByText('Receiving a reply from the legacy case assistant…')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No partial answer was saved');
    expect(screen.getByText('The reply was stopped; no partial answer was saved.')).toBeVisible();
    expect(await savedAiReplies()).toEqual([]);
  });
});
