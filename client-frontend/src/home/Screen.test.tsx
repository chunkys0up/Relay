import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RelayProvider } from '@relay/shared';
import Screen from './Screen';

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/founder/home']}>
      <RelayProvider role="founder"><Screen /></RelayProvider>
    </MemoryRouter>,
  );
}

describe('Founder Home', () => {
  it('keeps AI mode, task state, and the clarification route distinct', async () => {
    renderHome();
    expect(await screen.findByRole('heading', { name: 'Morning, Alex' })).toBeVisible();
    const stateGroup = screen.getByLabelText('Relay status');
    expect(within(stateGroup).getByText('Idle')).toBeVisible();
    expect(within(stateGroup).getByText('Thinking / Working')).toBeVisible();
    expect(within(stateGroup).getByText('Needs input')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Blocked')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Answer in Home chat' })).toHaveAttribute('href', '/founder/home#message-main');
    expect(screen.getByText(/simulated AI replies need the backend/)).toBeVisible();
    expect(screen.getByText(/240,000/)).toBeVisible();
    expect(screen.getByText(/280,000/)).toBeVisible();
  });
});
