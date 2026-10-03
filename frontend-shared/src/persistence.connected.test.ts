import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFixture } from './fixtures';
import type { CaseSnapshot } from './types';

vi.unmock('./persistence');
import { createBrowserRelayAdapter, sampleFingerprint } from './persistence';

afterEach(() => vi.unstubAllGlobals());

function fakeIndexedDB(): { factory: IDBFactory; names: string[] } {
  const databases = new Map<string, Map<string, unknown>>();
  const names: string[] = [];
  const factory = {
    open(name: string) {
      names.push(name);
      const first = !databases.has(name);
      if (first) databases.set(name, new Map());
      const values = databases.get(name)!;
      const database = {
        createObjectStore() { return {} as IDBObjectStore; },
        close() {},
        transaction() {
          let aborted = false;
          const transaction = {
            oncomplete: null as (() => void) | null,
            onabort: null as (() => void) | null,
            onerror: null as (() => void) | null,
            abort() { aborted = true; queueMicrotask(() => transaction.onabort?.()); },
            objectStore() {
              return {
                get(key: string) {
                  const request = { result: undefined as unknown, onsuccess: null as (() => void) | null };
                  queueMicrotask(() => {
                    request.result = values.get(key);
                    request.onsuccess?.();
                    if (!aborted) queueMicrotask(() => transaction.oncomplete?.());
                  });
                  return request as unknown as IDBRequest;
                },
                put(value: unknown, key: string) { values.set(key, structuredClone(value)); },
              } as unknown as IDBObjectStore;
            },
          };
          return transaction as unknown as IDBTransaction;
        },
      } as unknown as IDBDatabase;
      const request = {
        result: database,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      queueMicrotask(() => { if (first) request.onupgradeneeded?.(); request.onsuccess?.(); });
      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
  return { factory, names };
}

function importedSnapshot(content: string, packetHash: string): CaseSnapshot {
  const snapshot = createFixture();
  snapshot.packets[0].content = content;
  snapshot.packets[0].hash = packetHash;
  snapshot.packets[0].imported_pdf = { url: '/api/original', provider: 'Amazon Textract', original_sha256: packetHash };
  snapshot.grants[0].packet_hash = packetHash;
  snapshot.tasks = [];
  snapshot.flags = [];
  return snapshot;
}

describe('connected sample storage namespace', () => {
  it('changes for PDF hashes or version grants, while unchanged imports keep the same namespace', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const initial = createFixture();
    initial.packets[0].imported_pdf = { url: '/api/original', provider: 'Amazon Textract', original_sha256: 'a'.repeat(64) };
    initial.sources[0].imported_pdf = { url: '/api/original', provider: 'Amazon Textract', original_sha256: 'b'.repeat(64) };
    const original = await sampleFingerprint(initial);
    expect(await sampleFingerprint(structuredClone(initial))).toBe(original);

    const changedPdf = structuredClone(initial);
    changedPdf.sources[0].imported_pdf!.original_sha256 = 'c'.repeat(64);
    expect(await sampleFingerprint(changedPdf)).not.toBe(original);

    const revokedFromVersion = structuredClone(initial);
    revokedFromVersion.grants[0].source_ids = revokedFromVersion.grants[0].source_ids.slice(1);
    expect(await sampleFingerprint(revokedFromVersion)).not.toBe(original);

    const reorderedGrant = structuredClone(initial);
    reorderedGrant.grants[0].source_ids.reverse();
    expect(await sampleFingerprint(reorderedGrant)).toBe(original);
  });

  it('keeps local edits for unchanged PDFs and starts fresh when the imported hash changes', async () => {
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('BroadcastChannel', undefined);
    const storage = fakeIndexedDB();
    vi.stubGlobal('indexedDB', storage.factory);
    const initial = importedSnapshot('PDF content A', '1'.repeat(64));
    const firstAdapter = createBrowserRelayAdapter(0, { seedLoader: async () => structuredClone(initial) });
    const first = (await firstAdapter.snapshot('founder')).data;
    expect(first.packets[0].content).toBe('PDF content A');
    await firstAdapter.mutate('founder', {
      kind: 'message', expected_revision: first.revision, audience: { kind: 'private_ai' },
      text: 'Local edit', attachments: [], confirmed: false,
    }, { key: 'local-edit' });

    const unchangedAdapter = createBrowserRelayAdapter(0, { seedLoader: async () => structuredClone(initial) });
    const unchanged = (await unchangedAdapter.snapshot('founder')).data;
    expect(unchanged.messages.map(message => message.text)).toContain('Local edit');

    const changed = importedSnapshot('PDF content B', '2'.repeat(64));
    const changedAdapter = createBrowserRelayAdapter(0, { seedLoader: async () => changed });
    const fresh = (await changedAdapter.snapshot('founder')).data;
    expect(fresh.packets[0].content).toBe('PDF content B');
    expect(fresh.messages).toEqual([]);
    expect(new Set(storage.names.filter(name => name.startsWith('relay-connected-sample-v1-'))).size).toBe(2);
    expect(storage.names).not.toContain('relay-local-demo-v2');
  });

  it('shows a seed failure even when an older connected namespace exists', async () => {
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('BroadcastChannel', undefined);
    const storage = fakeIndexedDB();
    vi.stubGlobal('indexedDB', storage.factory);
    const initial = importedSnapshot('PDF content A', '1'.repeat(64));
    await createBrowserRelayAdapter(0, { seedLoader: async () => initial }).snapshot('founder');
    const before = storage.names.length;
    const offline = createBrowserRelayAdapter(0, { seedLoader: async () => { throw new Error('Imported PDFs unavailable'); } });
    await expect(offline.snapshot('founder')).rejects.toThrow('Imported PDFs unavailable');
    expect(storage.names).toHaveLength(before);
  });
});
