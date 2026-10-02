import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { RelayProvider } from '@relay/shared';
import Screen from './Screen';

afterEach(cleanup);

function LocationReadout() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderDocuments(path = '/founder/documents') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RelayProvider role="founder"><Screen /><LocationReadout /></RelayProvider>
    </MemoryRouter>,
  );
}

describe('Founder Documents', () => {
  it('opens a URL-selected packet version with source references and exact-version handoff', async () => {
    renderDocuments('/founder/documents?version=00000000-0000-4000-8000-000000000021');

    expect(await screen.findByRole('heading', { name: 'Documents' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Founder planning packet', level: 2 })).toBeVisible();
    expect(screen.getByText(/2026 revenue differs/)).toBeVisible();
    expect(await screen.findAllByRole('link', { name: /Founder intake/ })).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Preview handoff of v1' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Conversation' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Call' })).toHaveAttribute('href', '/founder/call');
    expect(screen.getByTestId('location')).toHaveTextContent('version=00000000-0000-4000-8000-000000000021');
  });

  it('keeps the current matching packet selected for a global search query', async () => {
    renderDocuments('/founder/documents?q=Founder');
    expect(await screen.findByRole('heading', { name: 'Founder planning packet', level: 2 })).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('q=Founder');
  });

  it('offers comparison only when another packet version exists', async () => {
    renderDocuments();
    expect(await screen.findByRole('button', { name: 'Compare versions' })).toBeDisabled();
    expect(screen.getByText(/current packet version/i)).toBeVisible();
    expect(screen.getByRole('link', { name: 'View sources' })).toHaveAttribute('href', '/founder/sources');
  });
});
