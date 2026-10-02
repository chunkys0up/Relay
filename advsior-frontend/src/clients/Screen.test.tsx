import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RelayProvider } from '@relay/shared';
import Screen from './Screen';

function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><RelayProvider role="advisor"><Routes><Route path="/advisor/clients" element={<Screen/>}/></Routes></RelayProvider></MemoryRouter>);
}

describe('advisor clients', () => {
  it('honors a source citation query and previews the shared original', async () => {
    mount('/advisor/clients?source=00000000-0000-4000-8000-000000000011');
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeTruthy();
    expect((await screen.findAllByText('Founder intake.pdf')).length).toBeGreaterThan(1);
    expect(await screen.findByText(/2026 annual revenue: \$240,000/)).toBeTruthy();
  });

  it('searches only the assigned client and offers a clear path for no results', async () => {
    mount('/advisor/clients?q=unassigned');
    expect(await screen.findByText('No matching assigned client')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Cedar Studio')).toBeNull());
  });
});
