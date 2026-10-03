import { advisorApi } from './advisorApi';
import type { AdvisorDocuments, AdvisorExtraction, AdvisorSession, AdvisorVersion } from './advisorApi';
import { advisor as browserAdvisor, founder } from './fixtures';
import { RelayError } from './types';
import type { Actor, CaseSnapshot, Citation, PacketVersion, Source } from './types';

function unavailable(message: string): never {
  throw new RelayError('CONNECTED_SAMPLE_UNAVAILABLE', message);
}

function requireImport(item: { extraction?: AdvisorExtraction; original_url?: string }, label: string): AdvisorExtraction {
  const extraction = item.extraction;
  if (extraction?.provider !== 'Amazon Textract' || extraction.status !== 'succeeded'
    || extraction.content_type !== 'application/pdf' || !item.original_url?.trim()) {
    unavailable(`${label} has no imported PDF with a successful Amazon Textract extraction.`);
  }
  return extraction;
}

function scopedOriginalUrl(originalUrl: string | undefined, caseId: string, version: AdvisorVersion,
  source?: { id: string; hash: string }): string {
  if (!originalUrl) unavailable('The imported PDF link is missing.');
  const casePath = `/api/advisor/cases/${encodeURIComponent(caseId)}`;
  const path = source
    ? `${casePath}/sources/${encodeURIComponent(source.id)}/original`
    : `${casePath}/packets/${encodeURIComponent(version.id)}/original`;
  const query = source
    ? new URLSearchParams({ version_id: version.id, packet_hash: version.hash, source_hash: source.hash })
    : new URLSearchParams({ packet_hash: version.hash });
  let url: URL;
  try { url = new URL(originalUrl, window.location.origin); }
  catch { return unavailable('The imported PDF link is invalid.'); }
  if (url.origin !== window.location.origin || url.pathname !== path || url.hash || url.username || url.password
    || [...url.searchParams].length !== [...query].length
    || [...query].some(([key, value]) => url.searchParams.get(key) !== value)) {
    unavailable('The imported PDF link does not match this authorized packet or source.');
  }
  return url.pathname + url.search;
}

function sourceCitation(source: AdvisorDocuments['sources'][number]): Citation {
  const page = source.locator.page ?? source.extraction?.lines[0]?.page ?? 1;
  return {
    source_id: source.id, source_hash: source.hash, source_kind: 'document',
    label: `${source.name} · p. ${page}`, locator: { page },
  };
}

function checkedDocument(session: AdvisorSession, version: AdvisorVersion, document: AdvisorDocuments): AdvisorDocuments {
  if (document.case_id !== session.workspace.case_id || document.versions.length !== 1
    || document.versions[0].id !== version.id || document.versions[0].hash !== version.hash) {
    unavailable(`The connected PDF response for packet v${version.version} no longer matches its authorized version.`);
  }
  const granted = new Set(version.source_ids);
  const returned = new Set(document.sources.map(source => source.id));
  if (returned.size !== document.sources.length || returned.size !== granted.size
    || document.sources.some(source => source.version_id !== version.id || !granted.has(source.id))) {
    unavailable(`The connected PDF sources for packet v${version.version} no longer match its grant.`);
  }
  return document;
}

/** Seed the local browser bridge from the synthetic advisor service's imported PDFs only. */
export async function loadCloudFixture(signal?: AbortSignal): Promise<CaseSnapshot> {
  const session = await advisorApi.session(signal);
  const versions = session.workspace.versions.slice().sort((left, right) => left.version - right.version);
  if (!versions.length) unavailable('No authorized imported PDFs are available for this synthetic workspace.');
  const documents = await Promise.all(versions.map(async version => checkedDocument(
    session, version, await advisorApi.documents(session.workspace.case_id, version, signal),
  )));
  // The browser engine uses fixed fictional actor IDs. The service session actor
  // stays on the API side and alone authorizes PDF reads; this is only local UI state.
  const advisor: Actor = { ...browserAdvisor, name: session.workspace.advisor.name };
  const sources = new Map<string, Source>();
  const packets: PacketVersion[] = [];
  const grants: CaseSnapshot['grants'] = [];

  documents.forEach((document, index) => {
    const grantedVersion = versions[index];
    const packet = document.versions[0];
    const packetExtraction = requireImport(packet, `Packet v${grantedVersion.version}`);
    const citations: Citation[] = [];
    for (const source of document.sources) {
      const extraction = requireImport(source, `Source ${source.name}`);
      const prior = sources.get(source.id);
      if (prior && (prior.hash !== source.hash || prior.excerpt !== source.text)) {
        unavailable(`Source ${source.name} changed between authorized packet versions.`);
      }
      const citation = sourceCitation(source);
      citations.push(citation);
      if (!prior) sources.set(source.id, {
        id: source.id, revision: 1, name: source.name, mime_type: extraction.content_type,
        bytes: extraction.bytes, hash: source.hash, created_at: extraction.extracted_at,
        extraction: 'ready', citations: [citation], excerpt: source.text, error: null,
        imported_pdf: { url: scopedOriginalUrl(source.original_url, session.workspace.case_id, grantedVersion, source),
          provider: 'Amazon Textract', original_sha256: extraction.original_sha256 },
      });
    }
    packets.push({
      id: packet.id, document_id: `${session.workspace.case_id}:packet`, version: packet.version,
      hash: packet.hash, created_at: packetExtraction.extracted_at, title: packet.title,
      status: 'in_review', previous_version_id: packets.at(-1)?.id ?? null,
      changes: [], citations, content: packet.text,
      imported_pdf: { url: scopedOriginalUrl(packet.original_url, session.workspace.case_id, grantedVersion),
        provider: 'Amazon Textract', original_sha256: packetExtraction.original_sha256 },
    });
    grants.push({
      id: `connected:${packet.id}`, revision: 1, advisor_id: advisor.id,
      packet_version_id: packet.id, packet_hash: packet.hash,
      source_ids: document.sources.map(source => source.id), message_ids: [],
    });
  });

  return {
    id: session.workspace.case_id, revision: 1, company: session.workspace.company,
    founder, advisors: [advisor], status: 'Advisor review', ui_state: 'Idle',
    activity: null, current_packet_version_id: packets.at(-1)?.id ?? null,
    sources: [...sources.values()], packets, tasks: [], messages: [], flags: [],
    clarifications: [], reviews: [], grants, call: null, event_cursor: 'connected-sample:1',
  };
}
