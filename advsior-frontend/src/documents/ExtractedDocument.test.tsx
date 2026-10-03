import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdvisorExtraction, AdvisorVersion } from '@relay/shared';
import ExtractedDocument, { advisorOriginalHref } from './ExtractedDocument';

afterEach(cleanup);

const version: AdvisorVersion = {
  id: 'packet-1', version: 1, hash: 'packet-hash', title: 'Planning packet', source_ids: ['source-1'],
};
const extraction: AdvisorExtraction = {
  provider: 'Amazon Textract', status: 'succeeded', filename: 'synthetic-packet.pdf',
  content_type: 'application/pdf', original_sha256: 'a'.repeat(64), bytes: 12345,
  pages: 2, extracted_at: '2026-10-03T12:00:00Z',
  lines: [{ page: 1, text: 'Revenue $240,000', confidence: 98.5 }],
  fields: [{ key: 'Revenue', value: '$240,000', page: 1, confidence: 99 }],
  tables: [{ page: 2, rows: [['Year', 'Revenue'], ['2026', '$240,000']] }],
};

describe('connected document extraction', () => {
  it('shows imported PDF metadata, actual text, page lines, fields, tables and a scoped original', () => {
    const originalHref = advisorOriginalHref(
      '/api/advisor/cases/case-1/sources/source-1/original?version_id=packet-1&packet_hash=packet-hash&source_hash=source-hash',
      'case-1', version, { id: 'source-1', hash: 'source-hash' },
    );
    render(<ExtractedDocument text="Revenue $240,000" extraction={extraction} originalHref={originalHref}/>);
    expect(screen.getByText('Server synthetic workspace · Amazon Textract extraction')).toBeInTheDocument();
    expect(screen.getByText('synthetic-packet.pdf')).toBeInTheDocument();
    expect(screen.getByText('12,345 bytes')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Document text' })).toHaveTextContent('Revenue $240,000');
    expect(screen.getByRole('region', { name: 'Extracted lines' })).toHaveTextContent('Page 1: Revenue $240,000');
    expect(screen.getByRole('region', { name: 'Extracted lines' })).toHaveTextContent('Confidence 98.5%');
    expect(screen.getByRole('region', { name: 'Extracted fields' })).toHaveTextContent('Revenue$240,000');
    expect(screen.getByRole('region', { name: 'Extracted fields' })).toHaveTextContent('Confidence 99%');
    expect(screen.getByRole('table')).toHaveTextContent('2026$240,000');
    expect(screen.getByRole('link', { name: 'Open original PDF' })).toHaveAttribute('href', originalHref);
  });

  it('keeps raw text visible and marks low-confidence lines and fields for review', async () => {
    const user = userEvent.setup();
    render(<ExtractedDocument text="Revenue $240,000" extraction={{
      ...extraction,
      lines: [{ page: 1, text: 'Revenue $240,000', confidence: 89.5 }],
      fields: [{ key: 'Revenue', value: '$240,000', page: 1, confidence: 72 }],
    }} originalHref={null}/>);
    expect(screen.getByRole('region', { name: 'Document text' })).toHaveTextContent('Revenue $240,000');
    expect(screen.getByRole('region', { name: 'Extracted fields' })).toHaveTextContent('Confidence 72% · Needs review');
    const summary = screen.getByText('Extracted lines (1) · Needs review');
    const details = summary.closest('details');
    expect(details).not.toHaveAttribute('open');
    await user.click(summary);
    expect(details).toHaveAttribute('open');
    expect(screen.getByRole('region', { name: 'Extracted lines' })).toHaveTextContent('Confidence 89.5% · Needs review');
  });

  it('identifies a local seed when no extraction is attached', () => {
    render(<ExtractedDocument text="Local draft" originalHref="/api/advisor/cases/case-1/packets/packet-1/original"/>);
    expect(screen.getByText('Local seed text · no S3 original attached')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Document text' })).toHaveTextContent('Local draft');
    expect(screen.queryByText(/Amazon Textract extraction/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open original PDF' })).not.toBeInTheDocument();
  });

  it('rejects unscoped and tampered original URLs', () => {
    const source = { id: 'source-1', hash: 'source-hash' };
    const path = '/api/advisor/cases/case-1/sources/source-1/original';
    const valid = `${path}?version_id=packet-1&packet_hash=packet-hash&source_hash=source-hash`;
    expect(advisorOriginalHref(valid, 'case-1', version, source)).toBe(new URL(valid, window.location.origin).href);
    for (const bad of [
      'https://elsewhere.example' + valid,
      valid.replace('case-1', 'other-case'),
      valid.replace('source-1', 'other-source'),
      valid.replace('source-hash', 'stale-hash'),
      valid.replace('packet-hash', 'stale-hash'),
      valid + '&download_url=https%3A%2F%2Felsewhere.example',
      valid + '#other',
      '/api/advisor/cases/case-1/sources/source-1/preview?version_id=packet-1&packet_hash=packet-hash&source_hash=source-hash',
    ]) expect(advisorOriginalHref(bad, 'case-1', version, source)).toBeNull();
    const packet = '/api/advisor/cases/case-1/packets/packet-1/original?packet_hash=packet-hash';
    expect(advisorOriginalHref(packet, 'case-1', version)).toBe(new URL(packet, window.location.origin).href);
    expect(advisorOriginalHref(packet.replace('packet-hash', 'stale-hash'), 'case-1', version)).toBeNull();
  });
});
