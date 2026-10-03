import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createFixture } from './fixtures';
import { MockRelayAdapter } from './mock';
import { SourcePreview, PacketPreview } from './ui';

vi.mock('./context', () => ({ useRelay: () => ({ snapshot: createFixture(), role: 'founder' }) }));
afterEach(cleanup);
const imported = { url: '/api/advisor/cases/c/packets/p/original?packet_hash=h', provider: 'Amazon Textract' as const, original_sha256: 'f'.repeat(64) };

describe('imported PDF previews', () => {
  it('shows the source original and extraction provenance instead of fixture-only claims', () => {
    const source = { ...createFixture().sources[0], imported_pdf: imported };
    render(<MemoryRouter><SourcePreview source={source}/></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Open original PDF' })).toHaveAttribute('href', imported.url);
    expect(screen.queryByText(/No original file bytes are available/)).not.toBeInTheDocument();
    expect(screen.getByText(/Text extracted by Amazon Textract/)).toBeVisible();
  });
  it('links imported packet previews to the real original', () => {
    render(<MemoryRouter><PacketPreview packet={{ ...createFixture().packets[0], imported_pdf: imported }}/></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Open original PDF' })).toHaveAttribute('href', imported.url);
  });
  it('does not carry a prior S3 original onto a new locally simulated draft', async () => {
    const adapter = new MockRelayAdapter(0);
    const state = adapter.exportState();
    state.state.packets[0].imported_pdf = imported;
    adapter.importState(state);
    const result = await adapter.mutate('founder', { kind: 'message', expected_revision: 1,
      audience: { kind: 'private_ai' }, text: '2026 revenue is $240,000. My reserve target is $60,000.',
      attachments: [], confirmed: false }, { key: 'pdf-derivative' });
    expect(result.data.packets[0].imported_pdf).toEqual(imported);
    expect(result.data.packets).toHaveLength(2);
    expect(result.data.packets[1].imported_pdf).toBeUndefined();
  });
});
