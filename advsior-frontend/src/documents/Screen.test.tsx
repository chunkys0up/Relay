import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { adapter, RelayProvider } from '@relay/shared';
import type { CaseSnapshot } from '@relay/shared';
import Screen from './Screen';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><LocationProbe/><RelayProvider role="advisor"><Routes><Route path="/advisor/documents" element={<Screen/>}/></Routes></RelayProvider></MemoryRouter>);
}

afterEach(() => { cleanup(); adapter.reset(); });

describe('advisor documents', () => {
  it('honors the selected packet version and keeps its review controls version-bound', async () => {
    mount('/advisor/documents?version=00000000-0000-4000-8000-000000000021');
    expect(await screen.findByRole('heading', { name: 'Documents' })).toBeTruthy();
    expect(await screen.findByRole('region', { name: 'Packet version 1 preview' })).toBeTruthy();
    expect(await screen.findByRole('combobox', { name: 'Packet version' })).toHaveValue('00000000-0000-4000-8000-000000000021');
    expect((await screen.findAllByRole('heading', { name: 'Review this version' })).length).toBeGreaterThan(1);
    expect(await screen.findByRole('heading', { name: 'Conversation' })).toBeTruthy();
  });

  it('previews an original only when it is in the selected packet grant', async () => {
    mount('/advisor/documents?source=00000000-0000-4000-8000-000000000011');
    expect(await screen.findByText(/2026 annual revenue: \$240,000/)).toBeTruthy();
    expect(await screen.findByText('Original · Synthetic')).toBeTruthy();
  });

  it('keeps an older packet selected when opening its granted source and hides decisions on the source preview', async () => {
    adapter.reset();
    const internal = adapter as unknown as { state: CaseSnapshot };
    const state = internal.state;
    const older = structuredClone(state.packets[0]);
    const newer = { ...structuredClone(older), id: '00000000-0000-4000-8000-000000000022', version: 2, hash: 'e'.repeat(64), previous_version_id: older.id, status: 'draft' as const };
    state.packets.push(newer);
    state.grants.push({ ...state.grants[0], id: 'g2', packet_version_id: newer.id, packet_hash: newer.hash });
    state.current_packet_version_id = newer.id;

    const user = userEvent.setup();
    mount('/advisor/documents?version=' + older.id);
    expect(await screen.findByRole('region', { name: 'Packet version 1 preview' })).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: /Founder intake\.pdf/ }));

    expect(screen.getByTestId('location-search')).toHaveTextContent('version=' + older.id);
    expect(screen.getByTestId('location-search')).toHaveTextContent('source=00000000-0000-4000-8000-000000000011');
    expect(await screen.findByRole('button', { name: 'Return to packet v1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Review approval of v1' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Return to packet v1' }));
    expect(screen.getByTestId('location-search')).toHaveTextContent('version=' + older.id);
    expect(screen.getByTestId('location-search')).not.toHaveTextContent('source=');
    expect(await screen.findByRole('region', { name: 'Packet version 1 preview' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Review approval of v1' })).toBeNull();
  });

  it('does not invent documents when the search has no shared result', async () => {
    mount('/advisor/documents?q=unshared');
    expect(await screen.findByText('No packet versions match this search.')).toBeTruthy();
    expect(await screen.findByText('No shared originals match this search.')).toBeTruthy();
  });
});
