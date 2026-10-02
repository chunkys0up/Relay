import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';
import { clearDrafts } from '../frontend-shared/src/drafts';

// Component tests use an isolated engine; real IndexedDB and tab transport are
// exercised by the browser suite, since jsdom does not implement IndexedDB.
vi.mock('../frontend-shared/src/persistence', async()=>{
 const { MockRelayAdapter }=await import('../frontend-shared/src/mock');
 return {createBrowserRelayAdapter:()=>new MockRelayAdapter()};
});
beforeEach(clearDrafts);
