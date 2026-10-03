import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ServerWorkflowPanel from './ServerWorkflowPanel';
import { getServerCase } from './serverPacketApi';
import { workflowRequest } from '../../client-frontend/src/workflow/api';
vi.mock('./serverPacketApi', () => ({ getServerCase: vi.fn() }));
vi.mock('../../client-frontend/src/workflow/api', () => ({ workflowRequest: vi.fn() }));
afterEach(cleanup);
const fields = ['company_name', 'founder_name', 'business_summary', 'annual_revenue', 'cash_reserve', 'period'];
const caseState = {
  id: 'case', company: 'Example', revision: 7, goal: 'Prepare', ui_state: 'Idle', status: 'Draft',
  sources: [{ id: 'original', name: 'Evidence.pdf', hash: 'source-hash', excerpt_count: 1 }],
  facts: Object.fromEntries(fields.map(field => [field, { state: 'unknown', value: null, confirmed_by: null, candidates: [] }])),
  jobs: [], messages: [], packets: [], flags: [], tasks: [], analysis_required: false,
  pdf_actions: [{ id: 'preview', hash: 'verified-hash', status: 'pending', fields: Object.fromEntries(fields.map(field => [field, 'Verified value'])), changes: [{ field: 'company_name', value: 'Verified value', evidence: [{ source_id: 'original', source_hash: 'source-hash', page: 1, quote: 'Original evidence' }] }], verification: { passed: true }, created_revision: 7 }],
};
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getServerCase).mockResolvedValue(caseState as never); vi.mocked(workflowRequest).mockResolvedValue({}); });
it('requires explicit evidence acknowledgement before saving the exact verified preview', async () => {
  render(<ServerWorkflowPanel caseId="case" revision={7} refresh={vi.fn()}/>);
  const save = await screen.findByRole('button', { name: 'Save reviewed PDF preview' });
  expect(save).toBeDisabled();
  fireEvent.click(screen.getByText('Review extracted facts and citations'));
  expect(screen.getByText('Original evidence')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(save);
  await waitFor(() => expect(workflowRequest).toHaveBeenCalledWith('/cases/case/pdf-actions/preview/confirm', { method: 'POST', body: { preview_hash: 'verified-hash', expected_revision: 7 } }));
});
it('shows source analysis failures without enabling generation', async () => {
  vi.mocked(getServerCase).mockResolvedValue({ ...caseState, analysis_required: true, pdf_actions: [], jobs: [{ id: 'job', status: 'blocked', error: 'BEDROCK_UNAVAILABLE' }] } as never);
  render(<ServerWorkflowPanel caseId="case" revision={7} refresh={vi.fn()}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('BEDROCK_UNAVAILABLE');
  expect(screen.getByRole('button', { name: 'Generate and verify packet PDF' })).toBeDisabled();
});
