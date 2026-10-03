import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import FounderCall from '../../client-frontend/src/call/Screen';
import AdvisorCall from '../../advsior-frontend/src/call/Screen';
import { RelayProvider, adapter } from './context';

describe('call screens with no authorized packet', () => {
  beforeEach(() => {
    adapter.reset();
    adapter.setScenario('empty');
  });
  afterEach(() => {
    cleanup();
    adapter.reset();
  });

  it('guides the founder to documents without showing an invitation', async () => {
    render(<MemoryRouter><RelayProvider role="founder"><FounderCall/></RelayProvider></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'No shared document is ready for a call' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'View Documents' })).toHaveAttribute('href', '/founder/documents');
    expect(screen.queryByRole('button', { name: /Call Maya Chen/ })).not.toBeInTheDocument();
  });

  it('guides the advisor to the assigned client without showing private material', async () => {
    render(<MemoryRouter><RelayProvider role="advisor"><AdvisorCall/></RelayProvider></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'No shared document is ready for a call' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'View Clients' })).toHaveAttribute('href', '/advisor/clients');
    expect(screen.queryByRole('region', { name: /Packet version/ })).not.toBeInTheDocument();
  });
});

