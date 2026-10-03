import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRelay } from './context';
import ServerCaseHome from './ServerCaseHome';
import { ServerAdvisorHome } from './ServerAdvisorViews';

vi.mock('./context', () => ({ useRelay: vi.fn() }));
vi.mock('./ServerWorkflowPanel', () => ({ default: () => null }));

afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

const caseState = {
  id: 'case-1',
  company: 'Harbor',
  revision: 4,
  status: 'Draft ready',
  server_legacy_sync_status: 'pending',
  server_synthetic_example: false,
  current_packet_version_id: null,
  sources: [],
  packets: [],
  tasks: [],
};

it('offers a manual retry for a pending storage sync without claiming success', async () => {
  const retrySync = vi.fn().mockResolvedValue(true);
  vi.mocked(useRelay).mockReturnValue({
    snapshot: caseState,
    cases: [caseState],
    refresh: vi.fn(),
    busy: false,
    retrySync,
  } as never);
  render(<MemoryRouter><ServerCaseHome /></MemoryRouter>);
  expect(screen.getByText('Legacy service sync: pending')).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry storage sync' }));
  expect(retrySync).toHaveBeenCalledOnce();
});

it('does not show a retry action after storage sync succeeds', () => {
  const synced = { ...caseState, server_legacy_sync_status: 'synced' };
  vi.mocked(useRelay).mockReturnValue({
    snapshot: synced,
    cases: [synced],
    refresh: vi.fn(),
    busy: false,
    retrySync: vi.fn(),
  } as never);
  render(<MemoryRouter><ServerCaseHome /></MemoryRouter>);
  expect(screen.getByText('Legacy service sync: synced')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry storage sync' })).not.toBeInTheDocument();
});

it('labels advisor task progress as private when the shared snapshot redacts tasks', () => {
  vi.mocked(useRelay).mockReturnValue({
    cases: [{ ...caseState, tasks: [], sources: [], packets: [] }],
    selectCase: vi.fn(),
  } as never);
  render(<MemoryRouter><ServerAdvisorHome /></MemoryRouter>);
  expect(screen.getByRole('cell', { name: 'Checklist private' })).toBeInTheDocument();
  expect(screen.queryByText('0 of 0 done')).not.toBeInTheDocument();
});
