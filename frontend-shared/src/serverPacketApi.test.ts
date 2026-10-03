import { describe, expect, it } from 'vitest';
import { mapServerCase, serverPacketUrl } from './serverPacketApi';
import type { ServerCase } from './serverPacketApi';

const caseState = {
  id: 'case-1', company: 'Northstar', revision: 8, status: 'Advisor review', ui_state: 'Idle',
  sources: [{ id: 'source-1', name: 'Evidence.pdf', hash: 'a'.repeat(64), mime_type: 'application/pdf',
    bytes: 400, created_at: '2026-10-03T10:00:00Z', extraction_status: 'ready' }],
  packets: [
    { id: 'packet-1', version: 1, hash: 'b'.repeat(64), created_at: '2026-10-03T11:00:00Z',
      title: 'Initial packet', stage: 'draft', fields: { company_name: 'Northstar' }, stage_events: [] },
    { id: 'packet-2', version: 2, hash: 'c'.repeat(64), created_at: '2026-10-03T12:00:00Z',
      title: 'Revised packet', stage: 'in_review', extracted_text: 'Actual PDF text from the backend', fields: { company_name: 'Northstar' },
      stage_events: [{ actor: 'founder', action: 'moved_to_review', at: '2026-10-03T12:05:00Z' }] },
  ],
  current_packet_id: 'packet-2',
  tasks: [{ id: 'task-1', title: 'Confirm details', state: 'done' }],
  flags: [{ field: 'annual_revenue', detail: 'Revenue needs confirmation', kind: 'missing' }],
  messages: [], facts: {}, jobs: [], goal: 'Plan',
} as unknown as ServerCase;

describe('server packet mapping', () => {
  it('uses exact backend packets, stage records, and PDF paths', () => {
    const result = mapServerCase(caseState);
    expect(result.packets).toHaveLength(2);
    expect(result.packets.map(packet => packet.status)).toEqual(['draft', 'in_review']);
    expect(result.packets[1].server_pdf_url).toBe(serverPacketUrl('case-1', 'packet-2'));
    expect(result.packets[1].stage_events?.[0].action).toBe('moved_to_review');
    expect(result.packets[1].content).toBe('Actual PDF text from the backend');
    expect(result.current_packet_version_id).toBe('packet-2');
    expect(result.founder.name).toBe('Founder');
    expect(result.tasks[0].state).toBe('Done');
    expect(result.flags[0].text).toBe('Revenue needs confirmation');
    expect(result.sources[0].server_pdf_url).toContain('/api/workflow/cases/case-1/sources/source-1/preview');
  });
  it('uses only a confirmed backend founder name', () => {
    const withFounder = { ...caseState, facts: { founder_name: { value: 'Maya Chen', state: 'confirmed', candidates: [], confirmed_by: 'synthetic_example' } } } as unknown as ServerCase;
    expect(mapServerCase(withFounder).founder.name).toBe('Maya Chen');
    const unconfirmed = { ...withFounder, facts: { founder_name: { value: 'Unverified Person', state: 'unknown', candidates: [], confirmed_by: null } } } as unknown as ServerCase;
    expect(mapServerCase(unconfirmed).founder.name).toBe('Founder');
  });
  it('rejects a missing server stage instead of presenting an invented draft', () => {
    const missing = { ...caseState, packets: [{ ...caseState.packets[0], stage: undefined }] };
    expect(() => mapServerCase(missing)).toThrow('recognized stage');
  });
});
