import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RelayProvider, adapter } from '@relay/shared';
import Screen from './Screen';

beforeEach(() => adapter.reset());
afterEach(cleanup);

describe('advisor Home client actions', () => {
  it('offers a direct named-client message path beside review', async () => {
    render(<MemoryRouter initialEntries={['/advisor/home']}><RelayProvider role="advisor"><Screen/></RelayProvider></MemoryRouter>);
    expect((await screen.findAllByText('Alex Morgan')).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Message client' })).toHaveAttribute('href', '/advisor/clients?audience=human#message-side');
  });
});
