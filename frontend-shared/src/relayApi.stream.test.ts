import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamChat } from './relayApi';

afterEach(() => vi.unstubAllGlobals());

describe('streamChat', () => {
  it('flushes trailing decoder bytes and releases the stream lock', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('Reply '));
      controller.enqueue(new Uint8Array([0xe2]));
      controller.close();
    } });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(body)));
    const chunks: string[] = [];
    const answer = await streamChat('session', 'prompt', chunk => chunks.push(chunk));
    expect(answer).toBe('Reply �');
    expect(chunks.join('')).toBe(answer);
    expect(body.locked).toBe(false);
  });

  it('rejects whitespace-only responses', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('   ')));
    await expect(streamChat('session', 'prompt', () => undefined)).rejects.toMatchObject({
      name: 'RelayApiError', message: 'The assistant returned an empty reply.',
    });
  });
});
