import { afterEach, describe, expect, it, vi } from 'vitest';
import { advisorApi } from './advisorApi';
import type { AdvisorDocuments, AdvisorExtraction, AdvisorSession, AdvisorVersion } from './advisorApi';
import { loadCloudFixture } from './cloudFixture';
import { advisor as browserAdvisor } from './fixtures';

afterEach(() => vi.restoreAllMocks());

const first: AdvisorVersion = { id: 'packet-1', version: 1, hash: '1'.repeat(64), title: 'Remote packet one', source_ids: ['source-1'] };
const second: AdvisorVersion = { id: 'packet-2', version: 2, hash: '2'.repeat(64), title: 'Remote packet two', source_ids: ['source-1', 'source-2'] };
const session: AdvisorSession = {
  mode: 'live', provider: 'Bedrock', csrf_token: 'test',
  workspace: { case_id: 'remote-case', company: 'Remote Company',
    advisor: { id: 'server-session-actor', name: 'Server Advisor' }, versions: [second, first] },
};

function extraction(filename: string, bytes: number, text: string): AdvisorExtraction {
  return {
    provider: 'Amazon Textract', status: 'succeeded', filename, content_type: 'application/pdf',
    original_sha256: 'a'.repeat(64), bytes, pages: 1, extracted_at: '2026-10-03T12:00:00Z',
    lines: [{ page: 1, text, confidence: 98 }], fields: [], tables: [],
  };
}

function packetUrl(version: AdvisorVersion): string {
  return `/api/advisor/cases/remote-case/packets/${version.id}/original?packet_hash=${version.hash}`;
}

function sourceUrl(sourceId: string, sourceHash: string, version: AdvisorVersion): string {
  return `/api/advisor/cases/remote-case/sources/${sourceId}/original?version_id=${version.id}&packet_hash=${version.hash}&source_hash=${sourceHash}`;
}

const sourceOne: AdvisorDocuments['sources'][number] = {
  id: 'source-1', version_id: 'packet-1', hash: '3'.repeat(64), name: 'Remote intake.pdf',
  text: 'Remote changed intake 991', locator: { page: 3 },
  extraction: extraction('Remote intake.pdf', 4096, 'Remote changed intake 991'),
  original_url: sourceUrl('source-1', '3'.repeat(64), first),
};
const sourceTwo: AdvisorDocuments['sources'][number] = {
  id: 'source-2', version_id: 'packet-2', hash: '4'.repeat(64), name: 'Remote forecast.pdf',
  text: 'Remote changed forecast 1234', locator: { page: 5 },
  extraction: extraction('Remote forecast.pdf', 8192, 'Remote changed forecast 1234'),
  original_url: sourceUrl('source-2', '4'.repeat(64), second),
};
const documents: Record<string, AdvisorDocuments> = {
  'packet-1': { case_id: 'remote-case', versions: [{ ...first, text: 'Remote packet one text',
    extraction: extraction('packet-one.pdf', 1024, 'Remote packet one text'), original_url: packetUrl(first) }],
  sources: [sourceOne] },
  'packet-2': { case_id: 'remote-case', versions: [{ ...second, text: 'Remote packet two changed text',
    extraction: extraction('packet-two.pdf', 2048, 'Remote packet two changed text'), original_url: packetUrl(second) }],
  sources: [{ ...sourceOne, version_id: 'packet-2', original_url: sourceUrl(sourceOne.id, sourceOne.hash, second) }, sourceTwo] },
};

function mockService() {
  vi.spyOn(advisorApi, 'session').mockResolvedValue(session);
  return vi.spyOn(advisorApi, 'documents').mockImplementation(async (_caseId, version) => structuredClone(documents[version.id]));
}

describe('connected sample seed', () => {
  it('maps every authorized PDF extraction into a fresh local snapshot', async () => {
    const requested = mockService();
    const snapshot = await loadCloudFixture();
    expect(requested).toHaveBeenCalledTimes(2);
    expect(requested.mock.calls.map(call => call[1].id)).toEqual(['packet-1', 'packet-2']);
    expect(snapshot.id).toBe('remote-case');
    expect(snapshot.company).toBe('Remote Company');
    expect(snapshot.advisors[0]).toEqual({ ...browserAdvisor, name: 'Server Advisor' });
    expect(snapshot.packets.map(packet => [packet.id, packet.hash, packet.content])).toEqual([
      ['packet-1', first.hash, 'Remote packet one text'],
      ['packet-2', second.hash, 'Remote packet two changed text'],
    ]);
    expect(snapshot.sources.map(source => [source.id, source.hash, source.bytes, source.excerpt])).toEqual([
      ['source-1', sourceOne.hash, 4096, 'Remote changed intake 991'],
      ['source-2', sourceTwo.hash, 8192, 'Remote changed forecast 1234'],
    ]);
    expect(snapshot.sources[0].citations[0]).toMatchObject({ source_hash: sourceOne.hash, locator: { page: 3 } });
    expect(snapshot.sources[0].imported_pdf).toMatchObject({ url: sourceOne.original_url, original_sha256: 'a'.repeat(64) });
    expect(snapshot.packets[1].imported_pdf).toMatchObject({ url: packetUrl(second), original_sha256: 'a'.repeat(64) });
    expect(snapshot.grants.map(grant => [grant.packet_version_id, grant.packet_hash, grant.source_ids])).toEqual([
      ['packet-1', first.hash, ['source-1']],
      ['packet-2', second.hash, ['source-1', 'source-2']],
    ]);
    expect(snapshot.current_packet_version_id).toBe('packet-2');
    expect(snapshot.status).toBe('Advisor review');
    expect(snapshot.ui_state).toBe('Idle');
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.flags).toEqual([]);
    expect(snapshot.messages).toEqual([]);
    expect(snapshot.reviews).toEqual([]);
  });

  it('rejects an unimported source instead of substituting fixture facts', async () => {
    mockService();
    const original = documents['packet-2'].sources[1];
    documents['packet-2'].sources[1] = { ...original, extraction: undefined, original_url: undefined };
    try {
      await expect(loadCloudFixture()).rejects.toThrow('has no imported PDF');
    } finally {
      documents['packet-2'].sources[1] = original;
    }
  });

  it('propagates service failures without creating a local seed', async () => {
    vi.spyOn(advisorApi, 'session').mockRejectedValue(new Error('Advisor service unavailable'));
    await expect(loadCloudFixture()).rejects.toThrow('Advisor service unavailable');
  });

  it('rejects an original link outside the selected version scope', async () => {
    mockService();
    const original = documents['packet-2'].sources[1];
    documents['packet-2'].sources[1] = { ...original, original_url: sourceUrl(sourceTwo.id, sourceTwo.hash, first) };
    try {
      await expect(loadCloudFixture()).rejects.toThrow('does not match this authorized packet or source');
    } finally {
      documents['packet-2'].sources[1] = original;
    }
  });
});
