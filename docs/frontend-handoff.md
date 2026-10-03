# Frontend implementation contract

Shared owner: Astra. Screen workers own only their assigned `src/<screen>/` folder
in their dedicated branch/worktree. Import primitives/types/hooks from
`@relay/shared`. Do not change manifests, lockfile, routing, shared CSS/components,
backend, specs or other screen files. Report shared changes to Astra.

Foundation is React/strict TypeScript, Vite and plain CSS. Existing directory
spellings remain. The runnable app, manifest, HTML, public assets and build config live in `frontend-shared/`, an npm workspace. A single dev server exposes separate role routes. The visible
role switch is explicitly a local fixture selector, not authentication.

`useRelay()` exposes `{snapshot,role,loading,busy,error,notice,scenario,run,refresh,
cancel,setScenario,clearNotice}`. `snapshot` is `CaseSnapshot|null`; inspect
`frontend-shared/src/types.ts`. `run(command:RelayCommand)` returns `Promise<boolean>`.
Always pass current expected revision and exact packet ID/hash for version actions.
Use `busy` to disable repeated actions. Mutation guard also prevents synchronous
double clicks. Backend and AWS are not connected.

Shared components: `Panel`, `PageTitle`, `Button` (primary/outline/subtle), `Badge`
(neutral/attention/success), `EmptyState`, `Icon`, `CitationLink`, `AgentStatus`,
`SourcePreview`, `PacketPreview`, `Conversation`, `ReviewControls`,
`HandoffControls`, `CallControls`, `ScreenState`. See implementations for prop types.
`Conversation` can be large, allowUpload (Home only), or humanOnly (call history).
ReviewControls implements draft/preview/explicit send/return/approval.
CallControls owns separate per-person consent and truthful simulated media states.

Shared CSS layout classes: workspace-grid (main + assistant), home-grid (chat +
to-do), call-grid (document + call), stack, row, wrap, toolbar, table-scroll,
table-button, breadcrumb, muted, confirm-panel, check-row. Add screen-specific CSS
inside your owned folder and import it in Screen.tsx; prefix selectors by screen.

Default export `Screen` from Screen.tsx. Founder routes: `/founder/home`,
`/founder/sources`, `/founder/documents`, `/founder/call`, and
`/founder/home/clarification` (same persisted conversation, no primary nav item).
Advisor: `/advisor/clients`, `/advisor/reviews`, `/advisor/documents`, `/advisor/call`.
Query parameters can select `source`, `version`, or search `q`. Navigation uses
React Router Link, never full reloads that reset the synthetic in-memory adapter.

Use the exact cached Figma design context, not the screenshot as an implementation.
Assets common to all screens are `/assets/{home,folder,file,call,settings,clients,
review,search,agent}.svg` downloaded from Figma. Download any unique static assets
inside your screen folder and import them. Do not redraw or substitute icons.
The nine ImageGen images were not located as separate files; actual editable Figma
frames are the inspected design source. Current product requirements override
outdated sample copy (v3/live labels, ownership versus financial conflict).

Fixtures intentionally show one missing reserve target and conflicting revenue,
with source citations. Simulated answers create an unapproved new version; renewed
handoff is required. All frontend persistence is in-memory, reset by full reload.

Install dependencies once from the repository root. Root scripts delegate to the frontend workspace. Checks from repository root: `npm run lint`, `npm run typecheck`, `npm test`,
`npm run build`, `npm run test:browser`. Shared dependency installation is owned by
Astra. Screen worker may symlink root node_modules from foundation worktree to
avoid independent installations. Commit only owned files to the screen branch.

Acceptance per screen: Figma layout adapted to responsive browser; keyboard/focus;
loading/empty/error; no false live/saved/upload claims; routes and role-filtered
data; appropriate cancellation/repeated-click behavior. Review must inspect actual
code and browser evidence. Sol independent verification is required before final
acceptance. Backend session/access, real uploads, delivery, Chime and transcription
remain blocked on Fabricator's contract and Andrew's infrastructure.
