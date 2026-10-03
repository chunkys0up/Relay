import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveAssistant, LiveCaseDocuments } from './live';
import { LIVE_CASE_ID } from './relayApi';

const fetchMock = vi.fn<typeof fetch>();
const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const stream = (...chunks: string[]): Response => new Response(new ReadableStream({
  start(controller) { const encoder = new TextEncoder(); for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); },
}));
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

describe('LiveAssistant', () => {
  it('streams the reply into the conversation', async () => {
    fetchMock.mockResolvedValueOnce(stream('Hi ', 'there'));
    render(<LiveAssistant role="founder" />);
    fireEvent.change(screen.getByLabelText('Message the live assistant'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Hi there')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/chat/stream');
    expect(JSON.parse(String(init?.body))).toMatchObject({ message: 'hello', session_id: expect.stringMatching(/^founder-/) });
  });

  it('evicts the old backend session when starting a new conversation', async () => {
    fetchMock.mockResolvedValueOnce(stream('ok')).mockResolvedValue(json({ status: 'cleared' }));
    render(<LiveAssistant role="founder" />);
    fireEvent.change(screen.getByLabelText('Message the live assistant'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('ok');
    const sessionId = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).session_id as string;
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith(`/api/chat/${sessionId}`) && init?.method === 'DELETE')).toBe(true));
    expect(screen.queryByText('ok')).toBeNull();
  });
});
