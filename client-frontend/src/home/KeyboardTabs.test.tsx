import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RelayProvider } from '@relay/shared';
import Screen from './Screen';

afterEach(cleanup);

function renderHome() {
  return render(<MemoryRouter initialEntries={['/founder/home']}><RelayProvider role="founder"><Screen /></RelayProvider></MemoryRouter>);
}

describe('Founder Home detail tabs', () => {
  it('moves between labeled panels with arrow, Home, and End keys', async () => {
    const user = userEvent.setup();
    renderHome();
    const tabs = within(await screen.findByRole('tablist', { name: 'Workspace details' }));
    const progress = tabs.getByRole('tab', { name: 'Progress' });
    const activity = tabs.getByRole('tab', { name: 'Activity' });

    progress.focus();
    await user.keyboard('{ArrowRight}');
    expect(activity).toHaveFocus();
    expect(activity).toHaveAttribute('aria-selected', 'true');
    expect(activity).toHaveAttribute('aria-controls', 'founder-home-aside-activity-panel');
    expect(screen.getByRole('tabpanel', { name: 'Activity' })).toHaveAttribute('id', 'founder-home-aside-activity-panel');

    await user.keyboard('{Home}');
    expect(progress).toHaveFocus();
    expect(progress).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Progress' })).toHaveAttribute('id', 'founder-home-aside-progress-panel');

    await user.keyboard('{End}');
    expect(activity).toHaveFocus();
    expect(activity).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(progress).toHaveFocus();
  });

  it('discloses only the known advisor identity and role', async () => {
    const user = userEvent.setup();
    renderHome();
    const disclosure = await screen.findByText('View profile');
    await user.click(disclosure);
    const profile = screen.getByRole('group', { name: 'Advisor profile' });
    expect(within(profile).getByText('Maya Chen')).toBeVisible();
    expect(within(profile).getByText('Advisor')).toBeVisible();
  });
});
