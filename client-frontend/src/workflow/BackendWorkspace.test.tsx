import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { BackendWorkspace } from './BackendWorkspace';
import { initializeWorkflowSession, workflowRequest, type WorkflowCase, type WorkflowFact } from './api';

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
