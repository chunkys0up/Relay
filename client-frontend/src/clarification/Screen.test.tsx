import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { RelayProvider, adapter } from '@relay/shared';
import Screen from './Screen';

async function sendAdvisorQuestion(): Promise<void> {
  const founderSnapshot = (await adapter.snapshot('founder')).data;
  const packet = founderSnapshot.packets.find((item) => item.id === founderSnapshot.current_packet_version_id);
  if (!packet) throw new Error('The founder fixture needs a packet.');
  const preview = await adapter.mutate('advisor', {
    kind: 'preview',
    expected_revision: founderSnapshot.revision,
    packet_version_id: packet.id,
    packet_hash: packet.hash,
    text: 'Can you confirm the reserve target?',
    recipient_id: founderSnapshot.founder.id,
    citations: founderSnapshot.flags.flatMap((flag) => flag.citations),
  }, { key: 'question-preview' });
  const clarification = preview.data.clarifications.find((item) => item.status === 'preview');
  if (!clarification) throw new Error('The advisor question preview was not created.');
  await adapter.mutate('advisor', {
    kind: 'send',
    expected_revision: preview.data.revision,
    packet_version_id: packet.id,
    packet_hash: packet.hash,
    clarification_id: clarification.id,
    clarification_revision: clarification.revision,
    text: clarification.text,
    recipient_id: clarification.recipient.id,
  }, { key: 'question-send' });
}

function renderFounderScreen(): void {
  render(<MemoryRouter><RelayProvider role="founder"><Screen /></RelayProvider></MemoryRouter>);
}

describe('founder clarification thread', () => {
  beforeEach(async () => {
    adapter.reset();
    await sendAdvisorQuestion();
  });

  afterEach(() => {
    cleanup();
    adapter.reset();
  });

  it('shows the actual advisor question author and founder answer author', async () => {
    renderFounderScreen();
    const question = await screen.findByRole('heading', { name: 'Can you confirm the reserve target?' });
    const questionCard = question.closest('.clarification-question');
    expect(questionCard).not.toBeNull();
    expect(within(questionCard as HTMLElement).getByText('Maya Chen')).toBeInTheDocument();
    expect(within(questionCard as HTMLElement).getByText(/Human advisor/)).toBeInTheDocument();
    expect(within(screen.getByTestId('clarification-answer-author')).getByText('Alex Morgan')).toBeInTheDocument();
  });

  it('previews before creating v2 and then links to the new draft', async () => {
    const user = userEvent.setup();
    renderFounderScreen();
    const answer = await screen.findByLabelText('Answer Maya Chen’s question');
    await user.type(answer, 'The reserve target is $60,000.');
    await user.click(screen.getByRole('button', { name: 'Preview answer' }));
    expect(screen.getByRole('heading', { name: 'Proposed packet change' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create simulated draft v2' }));
    expect(await screen.findByRole('heading', { name: 'Your answer is in a proposed packet revision.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review packet v2' })).toHaveAttribute('href', expect.stringContaining('version='));
    await waitFor(() => expect(screen.getByText('The reserve target is $60,000.')).toBeInTheDocument());
  });
});