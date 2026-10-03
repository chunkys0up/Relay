import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfViewer } from './PdfViewer';

const pdf = () => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { 'Content-Type': 'application/pdf' } });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:relay-pdf');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Call PDF viewer', () => {
  it('shows the newest generated packet PDF from the workflow backend', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/session')) return Promise.resolve(json({ csrf_token: 't', mode: 'simulated', provider: 'test' }));
      if (url.endsWith('/cases')) return Promise.resolve(json({ items: [{ id: 'c1', company: 'Northstar Labs', packets: [{ id: 'p1', version: 1, hash: 'a', created_at: '' }, { id: 'p2', version: 2, hash: 'b', created_at: '' }], sources: [] }] }));
      return Promise.resolve(pdf());
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PdfViewer/>);
    expect(await screen.findByTitle('PDF: Northstar Labs · packet v2')).toHaveAttribute('src', 'blob:relay-pdf');
    expect(fetchMock).toHaveBeenCalledWith('/api/workflow/cases/c1/packets/p2/download?inline=true', expect.anything());
    expect(screen.getByRole('link', { name: 'Open in new tab' })).toHaveAttribute('href', 'blob:relay-pdf');
  });

  it('lets the user switch between generated packets and uploaded source PDFs', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/session')) return Promise.resolve(json({ csrf_token: 't', mode: 'simulated', provider: 'test' }));
      if (url.endsWith('/cases')) return Promise.resolve(json({ items: [{ id: 'c1', company: 'Northstar Labs', packets: [{ id: 'p1', version: 1, hash: 'a', created_at: '' }], sources: [{ id: 's1', name: 'bank-statement.pdf', mime_type: 'application/pdf', hash: 'h', excerpt_count: 0 }, { id: 's2', name: 'notes.txt', mime_type: 'text/plain', hash: 'h2', excerpt_count: 0 }] }] }));
      return Promise.resolve(pdf());
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PdfViewer/>);
    await screen.findByTitle('PDF: Northstar Labs · packet v1');
    const picker = screen.getByRole('combobox', { name: 'PDF to view' });
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Northstar Labs · packet v1', 'Northstar Labs · bank-statement.pdf']);
    fireEvent.change(picker, { target: { value: 'c1:source:s1' } });
    expect(await screen.findByTitle('PDF: Northstar Labs · bank-statement.pdf')).toHaveAttribute('src', 'blob:relay-pdf');
    expect(fetchMock).toHaveBeenCalledWith('/api/workflow/cases/c1/sources/s1/preview', expect.anything());
  });

  it('opens a local PDF when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
    render(<PdfViewer/>);
    expect(await screen.findByText(/workflow backend is not reachable/)).toBeVisible();
    const file = new File(['%PDF-1.7'], 'term-sheet.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Open a PDF from this computer'), { target: { files: [file] } });
    expect(await screen.findByTitle('PDF: term-sheet.pdf · this computer')).toHaveAttribute('src', 'blob:relay-pdf');
  });
});
