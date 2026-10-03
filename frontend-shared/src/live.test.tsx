import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveCaseDocuments, useCaseActivity, useCaseChecklist } from './live';
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

  it('keeps an upload error visible after refreshing the document list', async () => {
    fetchMock.mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ detail: 'Upload could not be saved' }, 500))
      .mockResolvedValueOnce(json([]));
    render(<LiveCaseDocuments canUpload />);
    await screen.findByText('No documents yet');
    fireEvent.change(screen.getByLabelText('Upload documents'), { target: { files: [new File(['a,b'], 'cap-table.csv')] } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(await screen.findByRole('alert')).toHaveTextContent('Upload could not be saved');
  });

  it('refreshes documents, checklist and activity together after an upload', async () => {
    let uploaded = false;
    fetchMock.mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith('/documents/upload')) { uploaded = true; return json(doc); }
      if (url.includes('/checklist')) return json(uploaded ? [{ id: 'task-1', title: 'Review the uploaded cap table' }] : []);
      if (url.includes('/activity')) return json(uploaded ? [{ id: 'entry-1', text: 'Uploaded cap-table.csv' }] : []);
      return json(uploaded ? [doc] : []);
    });
    function CaseOverview() {
      const checklist = useCaseChecklist();
      const activity = useCaseActivity();
      return <><LiveCaseDocuments canUpload />
        <output aria-label="Checklist">{checklist.items?.map(item => item.title).join(', ') ?? 'Loading'}</output>
        <output aria-label="Activity">{activity.entries?.map(entry => entry.text).join(', ') ?? 'Loading'}</output>
      </>;
    }
    render(<CaseOverview />);
    await screen.findByText('No documents yet');
    await waitFor(() => {
      expect(screen.getByLabelText('Checklist')).toBeEmptyDOMElement();
      expect(screen.getByLabelText('Activity')).toBeEmptyDOMElement();
    });
    fireEvent.change(screen.getByLabelText('Upload documents'), { target: { files: [new File(['a,b'], 'cap-table.csv')] } });
    expect(await screen.findByText('cap-table.csv')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('Checklist')).toHaveTextContent('Review the uploaded cap table');
      expect(screen.getByLabelText('Activity')).toHaveTextContent('Uploaded cap-table.csv');
    });
  });

  it('does not show the previous case documents while a new case loads', async () => {
    fetchMock.mockResolvedValueOnce(json([doc])).mockImplementationOnce(() => new Promise<Response>(() => undefined));
    const view = render(<LiveCaseDocuments canUpload={false} caseId="first-case" />);
    await screen.findByText('cap-table.csv');
    view.rerender(<LiveCaseDocuments canUpload={false} caseId="second-case" />);
    expect(screen.queryByText('cap-table.csv')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading case documents');
  });

  it('ignores a late document response for the previous case', async () => {
    let resolveOld: (response: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce(json([{ ...doc, id: 'd2', case_id: 'second-case', filename: 'current.csv' }]));
    const view = render(<LiveCaseDocuments canUpload={false} caseId="first-case" />);
    view.rerender(<LiveCaseDocuments canUpload={false} caseId="second-case" />);
    await screen.findByText('current.csv');
    await act(async () => { resolveOld(json([doc])); });
    expect(screen.getByText('current.csv')).toBeInTheDocument();
    expect(screen.queryByText('cap-table.csv')).not.toBeInTheDocument();
  });

  it('shows the backend error detail', async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: 'case 123 not found' }, 404));
    render(<LiveCaseDocuments canUpload={false} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('case 123 not found');
  });
});
