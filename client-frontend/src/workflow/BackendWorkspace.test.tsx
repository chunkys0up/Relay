import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { BackendWorkspace } from './BackendWorkspace';
import { initializeWorkflowSession, workflowRequest, WorkflowRequestError, type WorkflowCase, type WorkflowFact } from './api';

vi.mock('./api', async importOriginal => ({
  ...await importOriginal<typeof import('./api')>(),
  initializeWorkflowSession: vi.fn(),
  workflowRequest: vi.fn(),
}));
const confirmedFact = (value: string): WorkflowFact => ({ value, state: 'confirmed', candidates: [], confirmed_by: 'founder' });
let state: WorkflowCase;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.stubGlobal('WebSocket', class {
    onopen = null; onclose = null; onmessage = null; onerror = null;
    send(): void {}
    close(): void {}
  });
  const values = { company_name: 'Northstar', founder_name: 'Alex', business_summary: 'Software', annual_revenue: '280000', cash_reserve: '60000', period: '2026' };
  state = {
    id: 'case-1', company: 'Northstar', goal: 'Update cash reserve', revision: 8, ui_state: 'Needs input', status: 'Review preview',
    sources: [], flags: [], tasks: [], messages: [], packets: [], jobs: [],
    facts: { company_name: confirmedFact(values.company_name), founder_name: confirmedFact(values.founder_name), business_summary: confirmedFact(values.business_summary), annual_revenue: confirmedFact(values.annual_revenue), cash_reserve: confirmedFact(values.cash_reserve), period: confirmedFact(values.period) },
    pdf_actions: [{ id: 'action-1', status: 'pending', created_revision: 8, hash: 'preview-hash', fields: { ...values, cash_reserve: '70000' }, changes: [{ field: 'cash_reserve', value: '70000', evidence: [{ source_id: 'message-1', source_hash: 'source-hash', page: 1, quote: 'Use 70000 for cash reserve.' }] }], base_packet_id: null, template_id: null, version: 1 }],
  };
  vi.mocked(initializeWorkflowSession).mockResolvedValue({ csrf_token: 'token', mode: 'simulated', provider: 'test' });
  vi.mocked(workflowRequest).mockImplementation(async path => {
    if (path === '/cases') return { items: [state] };
    if (path.endsWith('/confirm')) return { packet_id: 'packet-new' };
    return state;
  });
});
function show(): void {
  render(<MemoryRouter><BackendWorkspace view="chat" /></MemoryRouter>);
}
describe('AI PDF proposal confirmation', () => {
  it('requires explicit preview review and submits the exact preview hash', async () => {
    show();
    const save = await screen.findByRole('button', { name: 'Save reviewed PDF version' });
    expect(save).toBeDisabled();
    expect(screen.getByText('Proposed · not saved as a packet')).toBeVisible();
    expect(screen.getByTitle('Proposed PDF v1 preview')).toHaveAttribute('src', '/api/workflow/cases/case-1/pdf-actions/action-1/preview');
    await userEvent.click(screen.getByRole('checkbox', { name: /I reviewed this PDF preview/ }));
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(workflowRequest).toHaveBeenCalledWith('/cases/case-1/pdf-actions/action-1/confirm', {
      method: 'POST', body: { expected_revision: 8, preview_hash: 'preview-hash' },
    }));
  });
  it('blocks a stale preview without allowing confirmation', async () => {
    state.revision = 9;
    show();
    expect(await screen.findByRole('button', { name: 'Save reviewed PDF version' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /I reviewed this PDF preview/ })).toBeDisabled();
    expect(screen.getByText(/This proposal is out of date/)).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open proposed PDF preview in a new tab' })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Proposed PDF v1 preview')).not.toBeInTheDocument();
    expect(vi.mocked(workflowRequest).mock.calls.every(([path]) => !path.endsWith('/confirm'))).toBe(true);
  });
  it('revokes review when manual edits could conflict with the proposal', async () => {
    show();
    const save = await screen.findByRole('button', { name: 'Save reviewed PDF version' });
    await userEvent.click(screen.getByRole('checkbox', { name: /I reviewed this PDF preview/ }));
    expect(save).toBeEnabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Cash reserve (USD)' }), { target: { value: '90000' } });
    expect(save).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /I reviewed this PDF preview/ })).not.toBeChecked();
    expect(screen.getByText(/You have unsaved manual field edits/)).toBeVisible();
  });
});

describe('source-aware conversation and work', () => {
  it('shows cited conflicting answers, a focused question, and human/AI task dependencies in order', async () => {
    state.sources = [{ id: 'source-1', name: 'Current balance.pdf', hash: 'abc123456789', excerpt_count: 2, extraction_status: 'ready', interpretation_status: 'complete' }];
    state.facts.cash_reserve = { value: null, state: 'conflict', confirmed_by: null, candidates: [
      { value: '60000', evidence: [{ source_id: 'source-1', source_hash: 'abc123456789', page: 2, quote: 'Balance at year end: $60,000' }] },
    ] };
    state.flags = [{ field: 'cash_reserve', kind: 'conflict', detail: 'The uploaded statement disagrees with the earlier figure.', question: 'Which cash reserve figure should Relay use?' }];
    state.tasks = [
      { id: 'draft', key: 'packet', title: 'Create packet', state: 'Blocked', order: 3, dependencies: ['fact:reserve'], responsible_party: 'Relay', blocking_reason: 'Awaiting confirmed reserve', completion_condition: 'Verified PDF preview is ready' },
      { id: 'answer', key: 'fact:reserve', title: 'Resolve cash reserve', state: 'Blocked', order: 2, dependencies: ['analysis'], responsible_party: 'founder', blocking_reason: 'Founder confirmation needed', completion_condition: 'Founder confirms a cited value' },
      { id: 'analyze', key: 'analysis', title: 'Read sources', state: 'In progress', order: 1, dependencies: [], responsible_party: 'Relay', completion_condition: 'Citations validated' },
    ];
    show();
    expect(await screen.findByText('Current balance.pdf')).toBeVisible();
    expect(screen.getByText('Balance at year end: $60,000')).toBeVisible();
    expect(screen.getByText(/Which cash reserve figure should Relay use/)).toBeVisible();
    expect(screen.getByText(/The uploaded statement disagrees with the earlier figure/)).toBeVisible();
    const progress = screen.getByRole('region', { name: 'Backend task progress' });
    expect(within(progress).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      expect.stringContaining('Read sources'), expect.stringContaining('Resolve cash reserve'), expect.stringContaining('Create packet'),
    ]);
    expect(within(progress).getByText('Waiting for you')).toBeVisible();
    expect(within(progress).getByText('Relay · waiting')).toBeVisible();
    expect(within(progress).getByText('Relay working')).toBeVisible();
    expect(within(progress).getByText('After: Resolve cash reserve')).toBeVisible();
    expect(within(progress).getByText('After: Read sources')).toBeVisible();
    expect(within(progress).getByText('Blocked: Awaiting confirmed reserve')).toBeVisible();
    expect(within(progress).getByText('Done when: Verified PDF preview is ready')).toBeVisible();
  });

  it('uploads from chat for analysis and requires an inline source relationship decision', async () => {
    state.sources = [
      { id: 'prior', name: 'Old statement.txt', hash: 'oldhash', excerpt_count: 1 },
      { id: 'new', name: 'New statement.txt', hash: 'newhash', excerpt_count: 1, interpretation_status: 'complete', relationship_suggestion: { related_source_id: 'prior', reason: 'Same statement period.' } },
    ];
    show();
    await screen.findByRole('button', { name: 'Confirm replacement relationship' });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm replacement relationship' }));
    await waitFor(() => expect(workflowRequest).toHaveBeenCalledWith('/cases/case-1/sources/new/relationship', {
      method: 'POST', body: { expected_revision: 8, related_source_id: 'prior', decision: 'revision' },
    }));
    const file = new File(['updated record'], 'Later statement.txt', { type: 'text/plain' });
    await userEvent.upload(screen.getByLabelText('Add source in chat'), file);
    await waitFor(() => expect(vi.mocked(workflowRequest).mock.calls.some(([path, options]) => {
      if (path !== '/cases/case-1/sources' || !(options?.file instanceof FormData)) return false;
      return options.file.get('analyze') === 'true' && options.file.get('file') instanceof File;
    })).toBe(true));
  });

  it('can reject a proposed replacement and keep both originals separate', async () => {
    state.sources = [
      { id: 'prior', name: 'Statement.txt', hash: 'oldhash', excerpt_count: 1 },
      { id: 'new', name: 'Statement revised.txt', hash: 'newhash', excerpt_count: 1, relationship_suggestion: { related_source_id: 'prior', reason: 'The names are related.' } },
    ];
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Keep as separate source' }));
    await waitFor(() => expect(workflowRequest).toHaveBeenCalledWith('/cases/case-1/sources/new/relationship', {
      method: 'POST', body: { expected_revision: 8, related_source_id: 'prior', decision: 'separate' },
    }));
  });

  it('keeps the same send identity and revision when a response is lost and retried', async () => {
    let attempts = 0;
    vi.mocked(workflowRequest).mockImplementation(async path => {
      if (path === '/cases') return { items: [state] };
      if (path === '/cases/case-1/run' && attempts++ === 0) throw new Error('Connection lost');
      return state;
    });
    show();
    const input = await screen.findByRole('textbox', { name: 'Message Relay about this packet' });
    await userEvent.type(input, 'Please analyze this');
    await userEvent.click(screen.getByRole('button', { name: 'Analyze with test AI' }));
    expect(await screen.findByText('Connection lost')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Analyze with test AI' }));
    await waitFor(() => expect(vi.mocked(workflowRequest).mock.calls.filter(([path]) => path === '/cases/case-1/run')).toHaveLength(2));
    const [, first] = vi.mocked(workflowRequest).mock.calls.filter(([path]) => path === '/cases/case-1/run')[0];
    const [, second] = vi.mocked(workflowRequest).mock.calls.filter(([path]) => path === '/cases/case-1/run')[1];
    expect(first?.key).toBeTruthy();
    expect(second).toEqual(first);
  });

  it('recovers an uncertain send after reload without changing its identity', async () => {
    let attempts = 0;
    vi.mocked(workflowRequest).mockImplementation(async path => {
      if (path === '/cases') return { items: [state] };
      if (path === '/cases/case-1/run' && attempts++ === 0) throw new Error('Connection lost');
      return state;
    });
    show();
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message Relay about this packet' }), 'Resume this analysis');
    await userEvent.click(screen.getByRole('button', { name: 'Analyze with test AI' }));
    expect(await screen.findByText('Connection lost')).toBeVisible();
    expect(sessionStorage.getItem('relay.backend.pendingSend')).toContain('Resume this analysis');
    cleanup();
    show();
    expect(await screen.findByRole('textbox', { name: 'Message Relay about this packet' })).toHaveValue('Resume this analysis');
    await userEvent.click(screen.getByRole('button', { name: 'Analyze with test AI' }));
    await waitFor(() => expect(vi.mocked(workflowRequest).mock.calls.filter(([path]) => path === '/cases/case-1/run')).toHaveLength(2));
    const attemptsSent = vi.mocked(workflowRequest).mock.calls.filter(([path]) => path === '/cases/case-1/run');
    expect(attemptsSent[1][1]).toEqual(attemptsSent[0][1]);
    expect(sessionStorage.getItem('relay.backend.pendingSend')).toBeNull();
  });

  it('starts a new send identity after a definite stale revision rejection', async () => {
    let attempts = 0;
    vi.mocked(workflowRequest).mockImplementation(async path => {
      if (path === '/cases') return { items: [state] };
      if (path === '/cases/case-1/run' && attempts++ === 0) throw new WorkflowRequestError('Request stopped: stale revision.', 409, 'STALE_REVISION');
      return state;
    });
    show();
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message Relay about this packet' }), 'Analyze the figures');
    await userEvent.click(screen.getByRole('button', { name: 'Analyze with test AI' }));
    expect(await screen.findByText('Request stopped: stale revision.')).toBeVisible();
    expect(sessionStorage.getItem('relay.backend.pendingSend')).toBeNull();
    state.revision = 9;
    await userEvent.click(screen.getByRole('button', { name: 'Refresh backend workspace' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Analyze with test AI' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Analyze with test AI' }));
    await waitFor(() => expect(vi.mocked(workflowRequest).mock.calls.filter(([path]) => path === '/cases/case-1/run')).toHaveLength(2));
    const attemptsSent = vi.mocked(workflowRequest).mock.calls.filter(([path]) => path === '/cases/case-1/run');
    expect(attemptsSent[0][1]?.body).toEqual({ expected_revision: 8, goal: 'Analyze the figures' });
    expect(attemptsSent[1][1]?.body).toEqual({ expected_revision: 9, goal: 'Analyze the figures' });
    expect(attemptsSent[1][1]?.key).not.toBe(attemptsSent[0][1]?.key);
  });
});
