import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallControls } from './call';
import { useRelay } from './context';
import { createFixture } from './fixtures';
import type { CaseSnapshot, Role } from './types';

vi.mock('./context', () => ({ useRelay: vi.fn() }));

const run = vi.fn(async () => true);
let snapshot: CaseSnapshot;

function mount(role: Role): void {
  vi.mocked(useRelay).mockReturnValue({
    snapshot, role, busy: false, run,
  } as unknown as ReturnType<typeof useRelay>);
  const packet = snapshot.packets[0];
  render(<CallControls packet={packet}/>);
}

describe('call controls', () => {
  afterEach(cleanup);
  beforeEach(() => {
    snapshot = createFixture();
    run.mockClear();
  });

  it.each(['founder', 'advisor'] as const)('shows an honest %s pre-call preview and invites the assigned person for the shared version', role => {
    mount(role);
    const other = role === 'founder' ? snapshot.advisors[0] : snapshot.founder;
    expect(screen.getByRole('heading', { name: 'Ready to call?' })).toBeVisible();
    expect(screen.getByText('Your camera is off')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Camera device' })).toBeDisabled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Call ' + other.name }));
    expect(run).toHaveBeenCalledWith({
      kind: 'invite', expected_revision: snapshot.revision,
      packet_version_id: snapshot.packets[0].id,
      packet_hash: snapshot.packets[0].hash,
      recipient_id: other.id,
    });
  });

  it('accepts or declines an incoming invitation without exposing capture', () => {
    snapshot.call = {
      id: 'call-1', revision: 4, state: 'ringing',
      packet_version_id: snapshot.packets[0].id,
      participants: [
        { actor: snapshot.founder, accepted: true, muted: true, capture_consent: 'not_given', consent_revision: 0 },
        { actor: snapshot.advisors[0], accepted: false, muted: true, capture_consent: 'not_given', consent_revision: 0 },
      ],
      capture: 'off', processing: 'not_started', cleanup: 'not_required',
    };
    mount('advisor');
    expect(screen.getByText(/invited you to review this packet/)).toBeVisible();
    expect(screen.queryByText(/capture consent/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(run).toHaveBeenCalledWith({ kind: 'call_action', expected_revision: 4, action: 'accept' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Decline' })[0]);
    expect(run).toHaveBeenCalledWith({ kind: 'call_action', expected_revision: 4, action: 'decline' });
  });

  it('offers a fresh invitation after a failed simulated call', () => {
    snapshot.call = {
      id: 'call-failed', revision: 5, state: 'failed',
      packet_version_id: snapshot.packets[0].id,
      participants: [], capture: 'off',
      processing: 'not_started', cleanup: 'not_required',
    };
    mount('founder');
    expect(screen.getByRole('heading', { name: 'Ready to call?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Call Maya Chen' })).toBeEnabled();
  });

  it('prevents inviting an older packet version', () => {
    snapshot.current_packet_version_id = 'new-version';
    mount('founder');
    expect(screen.getByRole('button', { name: 'Call Maya Chen' })).toBeDisabled();
    expect(screen.getByText('Select the current shared packet to start a call.')).toBeVisible();
  });
});

