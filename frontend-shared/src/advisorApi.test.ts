import { afterEach, describe, expect, it, vi } from 'vitest';
import { advisorApi, advisorCitationHref } from './advisorApi';
import type { AdvisorVersion } from './advisorApi';

const version: AdvisorVersion = {
  id: 'packet-1', version: 1, hash: 'a'.repeat(64), title: 'Plan', source_ids: ['source-1'],
};
const caseId = 'case-1';
const sourceUrl = `/api/advisor/cases/${caseId}/sources/source-1/preview?version_id=packet-1&packet_hash=${version.hash}&source_hash=${'b'.repeat(64)}`;

afterEach(() => vi.unstubAllGlobals());

describe('advisor API boundary', () => {
  it('keeps requests on the advisor path and sends cookies, CSRF, and idempotency', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ conversation_id: 'conversation-1', case_id: caseId, versions: [{ id: version.id, hash: version.hash }], messages: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await advisorApi.send(caseId, 'conversation-1', 'What is missing?', 'csrf', 'request-1');
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/advisor/cases/case-1/conversations/conversation-1/messages');
    expect(init.credentials).toBe('include');
    expect(init.headers).toMatchObject({ 'X-CSRF-Token': 'csrf', 'Idempotency-Key': 'request-1' });
    expect(JSON.parse(init.body as string)).toEqual({ text: 'What is missing?' });
  });

  it('allows only exact scoped packet and source preview links', () => {
    const source = { source_id: 'source-1', source_hash: 'b'.repeat(64), version_id: version.id, label: 'Intake', url: sourceUrl };
    expect(advisorCitationHref(source, caseId, [version])).toContain('/api/advisor/cases/case-1/sources/source-1/preview');
    expect(advisorCitationHref({ ...source, url: 'https://evil.example/steal' }, caseId, [version])).toBeNull();
    expect(advisorCitationHref({ ...source, version_id: 'unshared' }, caseId, [version])).toBeNull();
    expect(advisorCitationHref({ ...source, source_id: 'private-source' }, caseId, [version])).toBeNull();
    expect(advisorCitationHref({ ...source, url: sourceUrl.replace('case-1', 'another-case') }, caseId, [version])).toBeNull();
    expect(advisorCitationHref({ ...source, url: sourceUrl.replace(version.hash, 'c'.repeat(64)) }, caseId, [version])).toBeNull();
    const packet = { source_id: version.id, source_hash: version.hash, version_id: version.id, label: 'Packet', url: `/api/advisor/cases/${caseId}/packets/${version.id}/preview?packet_hash=${version.hash}` };
    expect(advisorCitationHref(packet, caseId, [version])).toContain('/packets/packet-1/preview');
    expect(advisorCitationHref({ ...packet, source_hash: 'c'.repeat(64) }, caseId, [version])).toBeNull();
  });

  it('preserves structured retryable backend errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'MODEL_UNAVAILABLE', message: 'Bedrock unavailable', retryable: true } }), { status: 503 })));
    await expect(advisorApi.session()).rejects.toMatchObject({ status: 503, code: 'MODEL_UNAVAILABLE', message: 'Bedrock unavailable', retryable: true });
  });

  it('shares one cold session bootstrap between the document and chat panes', async () => {
    const session = { csrf_token: 'one-token', workspace: { case_id: caseId, versions: [version] } };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(session), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const [left, right] = await Promise.all([advisorApi.session(), advisorApi.session()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(left.csrf_token).toBe(right.csrf_token);
  });
});
