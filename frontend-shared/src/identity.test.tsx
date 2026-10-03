import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AgentStatus, PacketPreview } from './ui';
import { workspaceIdentity } from './identity';
import type { CaseSnapshot, PacketVersion } from './types';

const { useRelayMock } = vi.hoisted(() => ({ useRelayMock: vi.fn() }));
vi.mock('./context', () => ({ useRelay: useRelayMock }));

const snapshot = {
  company: 'Aster Foundry',
  founder: { id: 'founder-1', name: 'Avery Quinn', role: 'founder' },
  advisors: [{ id: 'advisor-1', name: 'Morgan Rivera', role: 'advisor' }],
} as Pick<CaseSnapshot, 'company' | 'founder' | 'advisors'>;

const packet: PacketVersion = {
  id: 'packet-1',
  document_id: 'document-1',
  version: 1,
  hash: 'a'.repeat(64),
  created_at: '2026-10-03T00:00:00Z',
  title: 'Planning packet',
  status: 'draft',
  previous_version_id: null,
  changes: [],
  citations: [],
  content: '1. Planning overview',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('workspace identity', () => {
  it('uses names and company from the active snapshot for both roles', () => {
    expect(workspaceIdentity(snapshot, 'founder')).toMatchObject({
      founderName: 'Avery Quinn',
      advisorName: 'Morgan Rivera',
      actorName: 'Avery Quinn',
      actorInitials: 'AQ',
      companyName: 'Aster Foundry',
    });
    expect(workspaceIdentity(snapshot, 'advisor')).toMatchObject({
      actorName: 'Morgan Rivera',
      actorInitials: 'MR',
      companyName: 'Aster Foundry',
    });
  });

  it('uses neutral labels while the workspace snapshot is unavailable', () => {
    expect(workspaceIdentity(null, 'founder')).toMatchObject({
      founderName: 'Founder',
      advisorName: 'Advisor',
      actorName: 'Founder',
      actorInitials: 'F',
      companyName: 'Demo workspace',
    });
    expect(workspaceIdentity(null, 'advisor')).toMatchObject({
      actorName: 'Advisor',
      actorInitials: 'A',
    });
  });

  it('renders packet previews with company and founder names from the snapshot', () => {
    useRelayMock.mockReturnValue({ snapshot });
    render(<MemoryRouter><PacketPreview packet={packet}/></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Aster Foundry' })).toBeVisible();
    expect(screen.getByText('Prepared for Avery Quinn · Synthetic data')).toBeVisible();
  });

  it('lets the chat lifecycle provide the assistant status and attention tone', () => {
    useRelayMock.mockReturnValue({ snapshot: null });
    render(<AgentStatus state="Needs input"/>);
    expect(screen.getByText('Needs input')).toHaveClass('badge-attention');
  });
});
