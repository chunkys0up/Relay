import type { AdvisorExtraction, AdvisorVersion } from '@relay/shared';
import './ExtractedDocument.css';

interface OriginalSource {
  id: string;
  hash: string;
}

/** Accept only the original belonging to this authorized case and exact packet/source hash. */
export function advisorOriginalHref(
  originalUrl: string | undefined,
  caseId: string,
  version: AdvisorVersion,
  source?: OriginalSource,
): string | null {
  if (!originalUrl) return null;
  const casePath = `/api/advisor/cases/${encodeURIComponent(caseId)}`;
  const path = source
    ? `${casePath}/sources/${encodeURIComponent(source.id)}/original`
    : `${casePath}/packets/${encodeURIComponent(version.id)}/original`;
  const query = source
    ? new URLSearchParams({ version_id: version.id, packet_hash: version.hash, source_hash: source.hash })
    : new URLSearchParams({ packet_hash: version.hash });
  let candidate: URL;
  try { candidate = new URL(originalUrl, window.location.origin); } catch { return null; }
  if (candidate.origin !== window.location.origin || candidate.pathname !== path || candidate.hash
    || candidate.username || candidate.password || [...candidate.searchParams].length !== [...query].length) return null;
  for (const [key, value] of query) {
    if (candidate.searchParams.get(key) !== value) return null;
  }
  return candidate.href;
}

interface ExtractedDocumentProps {
  text: string;
  extraction?: AdvisorExtraction;
  originalHref: string | null;
}

function Confidence({ value }: { value: number }) {
  const needsReview = value < 90;
  return <small className={needsReview ? 'advisor-extraction-low-confidence' : undefined}>
    Confidence {value}%{needsReview && ' · Needs review'}
  </small>;
}

export default function ExtractedDocument({ text, extraction, originalHref }: ExtractedDocumentProps) {
  const extracted = extraction?.provider === 'Amazon Textract' && extraction.status === 'succeeded';
  return <>
    {extracted ? <section className="advisor-extraction-meta" aria-label="Document extraction details">
      <p>Server synthetic workspace · Amazon Textract extraction</p>
      <dl>
        <dt>Original file</dt><dd>{extraction.filename}</dd>
        <dt>File type</dt><dd>{extraction.content_type}</dd>
        <dt>Size</dt><dd>{extraction.bytes.toLocaleString()} bytes</dd>
        <dt>Pages</dt><dd>{extraction.pages}</dd>
        <dt>Extracted</dt><dd>{extraction.extracted_at}</dd>
        <dt>Original SHA-256</dt><dd>{extraction.original_sha256}</dd>
      </dl>
      {originalHref && <a href={originalHref} target="_blank" rel="noopener noreferrer">Open original PDF</a>}
    </section> : <p className="advisor-extraction-seed">Local seed text · no S3 original attached</p>}
    <section className="advisor-extraction-section" aria-label="Document text"><h3>{extracted ? 'Extracted text' : 'Shared text'}</h3><pre>{text}</pre></section>
    {extracted && extraction.lines.length > 0 && <section className="advisor-extraction-section" aria-label="Extracted lines">
      <details className="advisor-extraction-lines">
        <summary>Extracted lines ({extraction.lines.length}){extraction.lines.some(line => line.confidence < 90) && ' · Needs review'}</summary>
        <ol>{extraction.lines.map((line, index) => <li key={`${line.page}-${index}`}><span>Page {line.page}: </span>{line.text} <Confidence value={line.confidence}/></li>)}</ol>
      </details>
    </section>}
    {extracted && extraction.fields.length > 0 && <section className="advisor-extraction-section" aria-label="Extracted fields">
      <h3>Extracted fields</h3>
      <dl>{extraction.fields.map((field, index) => <div key={`${field.page}-${field.key}-${index}`}><dt>{field.key}</dt><dd>{field.value} <small>(page {field.page})</small> <Confidence value={field.confidence}/></dd></div>)}</dl>
    </section>}
    {extracted && extraction.tables.map((table, index) => <section className="advisor-extraction-section" key={`${table.page}-${index}`} aria-label={`Extracted table ${index + 1}`}>
      <h3>Table {index + 1} · page {table.page}</h3>
      <table><tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>
    </section>)}
  </>;
}
