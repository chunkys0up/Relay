import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AdvisorDocuments, AdvisorSession } from '@relay/shared';
import ServerDocuments from './ServerDocuments';

vi.mock('@relay/shared', async importOriginal => {
  const actual = await importOriginal<typeof import('@relay/shared')>();
  return { ...actual, AdvisorChat: () => null };
});

const version = {
  id: 'packet-1', version: 1, hash: 'packet-hash', title: 'Planning packet', source_ids: ['source-1'],
};
const session: AdvisorSession = {
  mode: 'synthetic', provider: 'server', csrf_token: 'test',
  workspace: { case_id: 'case-1', company: 'Synthetic Company',
    advisor: { id: 'advisor-1', name: 'Advisor' }, versions: [version] },
};
const documents: AdvisorDocuments = {
  case_id: 'case-1',
  versions: [{ id: version.id, version: 1, hash: version.hash, title: version.title, text: 'Local packet seed' }],
  sources: [{ id: 'source-1', version_id: version.id, hash: 'source-hash', name: 'Synthetic intake.pdf',
    text: 'Revenue $240,000', locator: { page: 1 },
    original_url: '/api/advisor/cases/case-1/sources/source-1/original?version_id=packet-1&packet_hash=packet-hash&source_hash=source-hash',
    extraction: {
      provider: 'Amazon Textract', status: 'succeeded', filename: 'Synthetic intake.pdf',
      content_type: 'application/pdf', original_sha256: 'a'.repeat(64), bytes: 9876,
      pages: 1, extracted_at: '2026-10-03T12:00:00Z',
      lines: [{ page: 1, text: 'Revenue $240,000', confidence: 99 }],
      fields: [{ key: 'Revenue', value: '$240,000', page: 1, confidence: 99 }],
      tables: [],
    },
  }],
};

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockImplementation(async input => {
    const url = String(input);
    if (url.endsWith('/api/advisor/session')) return Response.json(session);
    if (url.includes('/api/advisor/cases/case-1/packets/packet-1/documents?')) return Response.json(documents);
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); fetchMock.mockReset(); vi.unstubAllGlobals(); });

it('shows local packet seed honestly, then renders the selected source extraction and original', async () => {
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={['/advisor/documents?advisor_demo=server']}><ServerDocuments/></MemoryRouter>);
  expect(await screen.findByRole('article', { name: 'Server packet version 1' })).toHaveTextContent('Local packet seed');
  expect(screen.getByText('Local seed text · no S3 original attached')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open original PDF' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Synthetic intake.pdf/ }));
  expect(await screen.findByRole('article', { name: 'Shared source preview' })).toHaveTextContent('Revenue $240,000');
  expect(screen.getByText('Server synthetic workspace · Amazon Textract extraction')).toBeInTheDocument();
  expect(screen.getByText('9,876 bytes')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Extracted fields' })).toHaveTextContent('Revenue$240,000');
  expect(screen.getByRole('link', { name: 'Open original PDF' })).toHaveAttribute('href',
    new URL(documents.sources[0].original_url ?? '', window.location.origin).href);
});
