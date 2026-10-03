import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RelayProvider, adapter } from '@relay/shared';
import Screen from './Screen';

beforeEach(() => {
  adapter.reset();
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async input => new Response(JSON.stringify(
    String(input).includes('/checklist')
      ? [{ id: 'blocked-task', title: 'Confirm revenue', detail: 'Resolve the two revenue figures', state: 'blocked' }]
      : [{ id: 'activity-1', actor: 'agent', text: 'Relay reviewed the revenue discrepancy', created_at: '2026-10-03T08:00:00Z' },
        { id: 'activity-2', actor: 'system', text: 'Case state refreshed', created_at: '2026-10-03T08:01:00Z' }],
  ), { headers: { 'Content-Type': 'application/json' } })));
});
afterEach(() => { cleanup(); adapter.reset(); vi.unstubAllGlobals(); });

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/founder/chat']}>
      <RelayProvider role="founder"><Screen /></RelayProvider>
    </MemoryRouter>,
  );
}

describe('Founder AI Chat', () => {
  it('shows live checklist and activity beside the private AI conversation', async () => {
    renderHome();
    expect(await screen.findByRole('heading', { name: 'AI Chat' })).toBeVisible();
    const stateGroup = screen.getByLabelText('Relay status');
    expect(within(stateGroup).getByText('Idle')).toBeVisible();
    expect(within(stateGroup).getByText('Thinking / Working')).toBeVisible();
    expect(within(stateGroup).getByText('Needs input')).toHaveAttribute('aria-current', 'step');
    expect(await screen.findByText('Blocked')).toBeVisible();
    expect(screen.getByText('Confirm revenue')).toBeVisible();
    expect(await screen.findByText('Relay reviewed the revenue discrepancy')).toBeVisible();
    expect(screen.getByText('Case state refreshed').closest('li')).toHaveTextContent('System');
    expect(screen.queryByRole('link', { name: 'Answer the question' })).not.toBeInTheDocument();
    expect(screen.getByText(/Legacy case assistant requests use the configured backend when you send/)).toBeVisible();
    expect(within(screen.getByLabelText('AI request status')).getByText('Idle')).toBeVisible();
    expect(within(stateGroup).getByText('Browser packet draft state')).toBeVisible();
    expect(screen.getByRole('tab', {name: 'AI assistant'})).toHaveAttribute('aria-selected', 'true');
  });

  it('routes an explicitly sent advisor question to the clarification screen', async () => {
    const snapshot = (await adapter.snapshot('founder')).data;
    const packet = snapshot.packets.find(item => item.id === snapshot.current_packet_version_id);
    if (!packet) throw new Error('A packet is required for the advisor question.');
    const preview = await adapter.mutate('advisor', {
      kind: 'preview', expected_revision: snapshot.revision, packet_version_id: packet.id,
      packet_hash: packet.hash, recipient_id: snapshot.founder.id,
      text: 'Is annual revenue $240,000 or $280,000?', citations: snapshot.flags.flatMap(flag => flag.citations),
    }, { key: 'chat-question-preview' });
    const question = preview.data.clarifications.find(item => item.status === 'preview');
    if (!question) throw new Error('The advisor question preview was not created.');
    await adapter.mutate('advisor', {
      kind: 'send', expected_revision: preview.data.revision, packet_version_id: packet.id,
      packet_hash: packet.hash, clarification_id: question.id, clarification_revision: question.revision,
      text: question.text, recipient_id: question.recipient.id,
    }, { key: 'chat-question-send' });
    renderHome();
    expect(await screen.findByRole('link', { name: 'Answer the question' })).toHaveAttribute('href', '/founder/home/clarification');
    expect(screen.getByLabelText('Advisor question')).toHaveTextContent('Maya Chen sent you a question');
    expect(screen.getByRole('tab', {name: 'AI assistant'})).toHaveAttribute('aria-selected', 'true');
  });
});
