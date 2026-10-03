import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveCaseDocuments, useCaseActivity, useCaseChecklist } from './live';
import { announceCaseUpdate, LIVE_CASE_ID } from './relayApi';

const fetchMock = vi.fn<typeof fetch>();
const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const doc = { id: 'd1', case_id: LIVE_CASE_ID, filename: 'cap-table.csv', s3_key: 'tenants/x/original.csv', uploaded_at: '2026-10-02T23:10:45Z' };
const checklistItem = { id: 'task-1', case_id: 'first-case', title: 'Review the plan', detail: null, state: 'todo' as const, position: 0, created_by: 'agent' as const, created_at: '2026-10-02T23:10:45Z', updated_at: '2026-10-02T23:10:45Z' };
const activityEntry = { id: 'entry-1', case_id: 'first-case', actor: 'agent' as const, text: 'Plan created', created_at: '2026-10-02T23:10:45Z' };

function ChecklistProbe({ caseId }: { caseId: string }) {
  const checklist = useCaseChecklist(caseId);
  return <>
    <output aria-label="Checklist state">{checklist.items?.[0]?.state ?? 'Loading'}</output>
    <output aria-label="Checklist error">{checklist.error ?? ''}</output>
    <button type="button" onClick={() => { void checklist.setState('task-1', 'done'); }}>Mark done</button>
  </>;
}

function ActivityProbe({ caseId }: { caseId: string }) {
  const activity = useCaseActivity(caseId);
  return <>
    <output aria-label="Activity text">{activity.entries?.[0]?.text ?? 'Loading'}</output>
    <output aria-label="Activity error">{activity.error ?? ''}</output>
  </>;
}

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

describe('case checklist and activity', () => {
  it('uses the canonical PATCH result and blocks duplicate pending changes', async () => {
    let resolvePatch: (response: Response) => void = () => undefined;
    fetchMock.mockImplementation((input, init) => {
      if (init?.method === 'PATCH') return new Promise<Response>(resolve => { resolvePatch = resolve; });
      return Promise.resolve(json([{ ...checklistItem, state: 'blocked' }]));
    });
    fetchMock.mockResolvedValueOnce(json([checklistItem]));
    render(<ChecklistProbe caseId="first-case" />);
    expect(await screen.findByLabelText('Checklist state')).toHaveTextContent('todo');
    fireEvent.click(screen.getByText('Mark done'));
    fireEvent.click(screen.getByText('Mark done'));
    expect(screen.getByLabelText('Checklist state')).toHaveTextContent('todo');
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
    await act(async () => { resolvePatch(json({ ...checklistItem, state: 'blocked' })); });
    expect(screen.getByLabelText('Checklist state')).toHaveTextContent('blocked');
  });

  it('refreshes after a rejected PATCH and keeps the error visible', async () => {
    fetchMock.mockImplementation((_input, init) => Promise.resolve(init?.method === 'PATCH'
      ? json({ detail: 'Checklist change rejected' }, 409)
      : json([checklistItem])));
    render(<ChecklistProbe caseId="first-case" />);
    await waitFor(() => expect(screen.getByLabelText('Checklist state')).toHaveTextContent('todo'));
    fireEvent.click(screen.getByText('Mark done'));
    await waitFor(() => expect(screen.getByLabelText('Checklist error')).toHaveTextContent('Checklist change rejected'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.getByLabelText('Checklist state')).toHaveTextContent('todo');
    expect(screen.getByLabelText('Checklist error')).toHaveTextContent('Checklist change rejected');
  });

  it('reconciles checklist and activity when the server saves a PATCH but the response fails', async () => {
    let saved = false;
    fetchMock.mockImplementation((input, init) => {
      if (init?.method === 'PATCH') {
        saved = true;
        return Promise.resolve(json({ detail: 'Response lost after save' }, 500));
      }
      if (String(input).includes('/activity')) return Promise.resolve(json(saved
        ? [{ ...activityEntry, text: 'Plan completed' }]
        : [activityEntry]));
      return Promise.resolve(json([saved ? { ...checklistItem, state: 'done' } : checklistItem]));
    });
    render(<><ChecklistProbe caseId="first-case" /><ActivityProbe caseId="first-case" /></>);
    await waitFor(() => {
      expect(screen.getByLabelText('Checklist state')).toHaveTextContent('todo');
      expect(screen.getByLabelText('Activity text')).toHaveTextContent('Plan created');
    });
    fireEvent.click(screen.getByText('Mark done'));
    await waitFor(() => {
      expect(screen.getByLabelText('Checklist state')).toHaveTextContent('done');
      expect(screen.getByLabelText('Activity text')).toHaveTextContent('Plan completed');
    });
    expect(screen.getByLabelText('Checklist error')).toHaveTextContent('Response lost after save');
  });

  it('does not let an earlier checklist GET overwrite a confirmed PATCH', async () => {
    let resolveStale: (response: Response) => void = () => undefined;
    let listCount = 0;
    fetchMock.mockImplementation((_input, init) => {
      if (init?.method === 'PATCH') return Promise.resolve(json({ ...checklistItem, state: 'blocked' }));
      listCount += 1;
      if (listCount === 2) return new Promise<Response>(resolve => { resolveStale = resolve; });
      return Promise.resolve(json([listCount === 1 ? checklistItem : { ...checklistItem, state: 'blocked' }]));
    });
    render(<ChecklistProbe caseId="first-case" />);
    await waitFor(() => expect(screen.getByLabelText('Checklist state')).toHaveTextContent('todo'));
    act(() => { announceCaseUpdate(); });
    await waitFor(() => expect(listCount).toBe(2));
    fireEvent.click(screen.getByText('Mark done'));
    await waitFor(() => expect(screen.getByLabelText('Checklist state')).toHaveTextContent('blocked'));
    await act(async () => { resolveStale(json([checklistItem])); });
    expect(screen.getByLabelText('Checklist state')).toHaveTextContent('blocked');
  });

  it('ignores a late old-case checklist GET after the case changes', async () => {
    let resolveOld: (response: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce(json([{ ...checklistItem, case_id: 'second-case', state: 'done' }]));
    const view = render(<ChecklistProbe caseId="first-case" />);
    view.rerender(<ChecklistProbe caseId="second-case" />);
    await waitFor(() => expect(screen.getByLabelText('Checklist state')).toHaveTextContent('done'));
    await act(async () => { resolveOld(json([checklistItem])); });
    expect(screen.getByLabelText('Checklist state')).toHaveTextContent('done');
  });

  it('ignores an old-case PATCH after switching cases', async () => {
    let resolvePatch: (response: Response) => void = () => undefined;
    fetchMock.mockImplementation((input, init) => {
      if (init?.method === 'PATCH') return new Promise<Response>(resolve => { resolvePatch = resolve; });
      return Promise.resolve(json([String(input).includes('second-case')
        ? { ...checklistItem, case_id: 'second-case', state: 'blocked' }
        : checklistItem]));
    });
    const view = render(<ChecklistProbe caseId="first-case" />);
    await waitFor(() => expect(screen.getByLabelText('Checklist state')).toHaveTextContent('todo'));
    fireEvent.click(screen.getByText('Mark done'));
    view.rerender(<ChecklistProbe caseId="second-case" />);
    expect(screen.getByLabelText('Checklist state')).toHaveTextContent('Loading');
    await waitFor(() => expect(screen.getByLabelText('Checklist state')).toHaveTextContent('blocked'));
    await act(async () => { resolvePatch(json({ ...checklistItem, state: 'done' })); });
    expect(screen.getByLabelText('Checklist state')).toHaveTextContent('blocked');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('hides previous activity and ignores a late old-case response', async () => {
    let resolveOld: (response: Response) => void = () => undefined;
    fetchMock.mockResolvedValueOnce(json([activityEntry]))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce(json([{ ...activityEntry, case_id: 'second-case', text: 'New case activity' }]));
    const view = render(<ActivityProbe caseId="first-case" />);
    await waitFor(() => expect(screen.getByLabelText('Activity text')).toHaveTextContent('Plan created'));
    act(() => { announceCaseUpdate(); });
    view.rerender(<ActivityProbe caseId="second-case" />);
    expect(screen.getByLabelText('Activity text')).toHaveTextContent('Loading');
    await waitFor(() => expect(screen.getByLabelText('Activity text')).toHaveTextContent('New case activity'));
    await act(async () => { resolveOld(json([activityEntry])); });
    expect(screen.getByLabelText('Activity text')).toHaveTextContent('New case activity');
  });
});
