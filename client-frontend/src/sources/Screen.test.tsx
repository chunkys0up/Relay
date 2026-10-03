import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { RelayProvider } from '@relay/shared';
import Screen from './Screen';

afterEach(cleanup);

function LocationReadout() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderSources(path = '/founder/sources') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RelayProvider role="founder"><Screen /><LocationReadout /></RelayProvider>
    </MemoryRouter>,
  );
}

describe('Founder Sources', () => {
  it('selects the source from the URL and supports source-only browsing', async () => {
    renderSources('/founder/sources?source=00000000-0000-4000-8000-000000000013');
    expect(await screen.findByRole('heading', { name: 'Forecast assumptions.pdf', level: 2 })).toBeVisible();
    expect(screen.getByText(/2026 annual revenue forecast: \$280,000/)).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Search original sources' })).toBeVisible();
    expect(screen.queryByLabelText('Attach a source')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Conversation' })).toBeVisible();
    expect(screen.getByRole('link', { name: /Upload documents on Home/ })).toHaveAttribute('href', '/founder/home');
  });

  it('labels page locators accurately and identifies fixture originals', async () => {
    renderSources('/founder/sources?source=00000000-0000-4000-8000-000000000011');
    expect(await screen.findByRole('heading', { name: 'Founder intake.pdf', level: 2 })).toBeVisible();
    expect(screen.getByText('p. 2 · 142 KB')).toBeVisible();
    expect(screen.queryByText('2 pages · 142 KB')).not.toBeInTheDocument();
    expect(screen.getByText(/Actual file bytes stay in this browser/)).toBeVisible();
  });

  it('updates the selected source and keeps the query parameter in the URL', async () => {
    const user = userEvent.setup();
    renderSources();
    const sourceButton = await screen.findByRole('button', { name: /Forecast assumptions.pdf/ });
    await user.click(sourceButton);
    expect(await screen.findByText(/2026 annual revenue forecast: \$280,000/)).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('source=00000000-0000-4000-8000-000000000013');
    await user.type(screen.getByRole('searchbox', { name: 'Search original sources' }), 'forecast');
    expect(screen.getByTestId('location')).toHaveTextContent('q=forecast');
    expect(screen.getByRole('button', { name: /Forecast assumptions.pdf/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Founder intake.pdf/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
  });
});
