import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveCaseDocuments } from './live';
import { LIVE_CASE_ID } from './relayApi';

const fetchMock = vi.fn<typeof fetch>();
const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const doc = { id: 'd1', case_id: LIVE_CASE_ID, filename: 'cap-table.csv', s3_key: 'tenants/x/original.csv', uploaded_at: '2026-10-02T23:10:45Z' };

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('LiveCaseDocuments', () => {
  it('lists backend documents for the case', async () => {
    fetchMock.mockResolvedValueOnce(json([doc]));
    render(<LiveCaseDocuments canUpload={false} />);
    expect(await screen.findByText('cap-table.csv')).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/api/documents?case_id=${LIVE_CASE_ID}`);
    expect(screen.queryByLabelText('Upload documents')).toBeNull();
  });

  it('uploads a file as multipart with the case id, then refreshes the list', async () => {
    fetchMock.mockResolvedValueOnce(json([])).mockResolvedValueOnce(json({ ...doc, source_id: 'd1', bucket: 'b', key: 'k', content_type: 'text/csv', size: 9 })).mockResolvedValueOnce(json([doc]));
    render(<LiveCaseDocuments canUpload />);
    await screen.findByText('No documents yet');
    fireEvent.change(screen.getByLabelText('Upload documents'), { target: { files: [new File(['a,b'], 'cap-table.csv', { type: 'text/csv' })] } });
    expect(await screen.findByText('cap-table.csv')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toContain('/api/documents/upload');
    const body = init?.body as FormData;
    expect(body.get('case_id')).toBe(LIVE_CASE_ID);
    expect((body.get('file') as File).name).toBe('cap-table.csv');
  });

  it('shows the backend error detail', async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: 'case 123 not found' }, 404));
    render(<LiveCaseDocuments canUpload={false} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('case 123 not found');
  });
});
