import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RelayProvider } from '@relay/shared';
import Screen from './Screen';

function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><RelayProvider role="advisor"><Routes><Route path="/advisor/documents" element={<Screen/>}/></Routes></RelayProvider></MemoryRouter>);
}

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

  it('does not invent documents when the search has no shared result', async () => {
    mount('/advisor/documents?q=unshared');
    expect(await screen.findByText('No packet versions match this search.')).toBeTruthy();
    expect(await screen.findByText('No shared originals match this search.')).toBeTruthy();
  });
});
