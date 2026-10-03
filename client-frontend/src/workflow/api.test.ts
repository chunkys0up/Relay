import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeWorkflowSession, workflowRequest } from './api';

afterEach(() => { vi.unstubAllGlobals(); });
describe('workflow transport', () => {
  it('shares first session creation across concurrent StrictMode initializers and sends matching CSRF', async () => {
    const info = { mode: 'simulated', provider: 'fixture', csrf_token: 'test-csrf' };
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>(done => { resolve = done; });
    const fetch = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const first = initializeWorkflowSession();
    const second = initializeWorkflowSession();
    expect(first).toBe(second);
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve(new Response(JSON.stringify(info)));
    await expect(first).resolves.toEqual(info);
    await workflowRequest('/cases', { method: 'POST', body: { company: 'Fictional' }, key: 'stable-key' });
    expect(fetch.mock.calls[1][1].headers).toMatchObject({ 'X-CSRF-Token': 'test-csrf', 'Idempotency-Key': 'stable-key' });
    expect(fetch.mock.calls[1][1].credentials).toBe('same-origin');
  });
  it('surfaces a backend failure instead of treating it as an AI reply', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'BEDROCK_UNAVAILABLE' } }), { status: 503 })));
    await expect(workflowRequest('/cases')).rejects.toThrow('bedrock unavailable');
  });
});
