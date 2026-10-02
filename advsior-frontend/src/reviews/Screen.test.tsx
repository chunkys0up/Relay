import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RelayProvider } from '@relay/shared';
import Screen from './Screen';

function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><RelayProvider role="advisor"><Routes><Route path="/advisor/reviews" element={<Screen/>}/></Routes></RelayProvider></MemoryRouter>);
}

describe('advisor reviews', () => {
  it('selects the requested shared version and shows its source-linked flags and exact-version controls', async () => {
    mount('/advisor/reviews?version=00000000-0000-4000-8000-000000000021');
    expect(await screen.findByRole('heading', { name: 'Reviews' })).toBeTruthy();
    expect((await screen.findAllByText(/2026 revenue differs/)).length).toBeGreaterThan(1);
    expect(await screen.findByRole('heading', { name: 'Review this version' })).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Open document review' })).toHaveAttribute('href','/advisor/documents?version=00000000-0000-4000-8000-000000000021');
  });

  it('does not show results outside the assigned packet set', async () => {
    mount('/advisor/reviews?q=cedar');
    expect(await screen.findByText('No matching assigned review')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Cedar Studio')).toBeNull());
  });
});
