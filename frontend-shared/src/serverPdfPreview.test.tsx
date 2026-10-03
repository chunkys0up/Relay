import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createFixture } from './fixtures';
import { PacketPreview } from './ui';

vi.mock('./context', () => ({ useRelay: () => ({ snapshot: createFixture(), role: 'founder' }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('server PDF preview', () => {
  it('shows text extracted from the stored PDF even when the browser viewer is blank', async () => {
    const pdfUrl = '/api/workflow/cases/case-a/packets/packet-a/download?inline=true';
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async input => {
      if (String(input).endsWith('/preview-text')) return Response.json({ status: 'readable', text: 'Verified text from the imported PDF' });
      return new Response(new Uint8Array([37, 80, 68, 70]), { headers: { 'Content-Type': 'application/pdf' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test-pdf'), revokeObjectURL: vi.fn() }));
    const packet = { ...createFixture().packets[0], id: 'packet-a', content: '', server_pdf_url: pdfUrl };
    render(<MemoryRouter><PacketPreview packet={packet}/></MemoryRouter>);
    expect(await screen.findByText('Verified text from the imported PDF')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith('/api/workflow/cases/case-a/packets/packet-a/preview-text', expect.objectContaining({ credentials: 'same-origin' }));
    expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', pdfUrl);
  });
});
