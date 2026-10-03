import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ServerRelayProvider, useRelay } from './context';
import { WorkflowRequestError } from '../../client-frontend/src/workflow/api';

const session=vi.hoisted(()=>({role:'founder' as 'founder'|'advisor'}));
const api = vi.hoisted(() => ({
  listServerCases: vi.fn(), getServerCase: vi.fn(), createServerCase: vi.fn(),
  loadServerExamples: vi.fn(), importServerPacket: vi.fn(), changeServerPacketStage: vi.fn(),
  createServerShare:vi.fn(), reviewServerPacket:vi.fn(), revokeServerShare:vi.fn(),
  redeemServerShare:vi.fn(),
  mapServerCase: vi.fn(),
}));
vi.mock('./serverPacketApi', () => api);
vi.mock('../../client-frontend/src/workflow/api', () => ({
  initializeWorkflowSession: vi.fn(async () => ({actor:{role:session.role}})),
  WorkflowRequestError: class WorkflowRequestError extends Error {
    constructor(message:string,_status:number,readonly code?:string){super(message);}
  },
}));

function Probe() {
  const { snapshot, selectedCaseId, loading, createCase, selectCase } = useRelay();
  return <div>
    <span>{loading ? 'loading' : `${selectedCaseId ?? 'none'}:${snapshot?.id ?? 'none'}`}</span>
    <button type="button" onClick={() => {void createCase?.('Acme', 'Plan');}}>Create</button>
    <button type="button" onClick={() => selectCase?.('new-case')}>Open current case</button>
  </div>;
}

afterEach(() => {cleanup();vi.clearAllMocks();localStorage.clear();session.role='founder';});

function SharingProbe() {
  const {snapshot,inviteCode,error,createShare,reviewPacket} = useRelay();
  const packet=snapshot?.packets[0];
  return <div>
    <span>{snapshot?.revision ?? 'none'}</span>
    <span>{inviteCode ?? 'no invite code'}</span>
    {error&&<span>{error}</span>}
    <button type="button" disabled={!packet} onClick={()=>{if(packet)void createShare?.(packet,[]);}}>Invite</button>
    <button type="button" disabled={!packet} onClick={()=>{if(packet)void reviewPacket?.(packet,'approved','');}}>Review</button>
  </div>;
}

function AdditionalInvitationProbe() {
  const {cases,selectedCaseId,snapshot,redeemShare,selectCase}=useRelay();
  return <div>
    <span>{selectedCaseId ?? 'none'}:{snapshot?.id ?? 'none'}:{cases?.map(item=>item.id).join(',') ?? ''}</span>
    <button type="button" onClick={()=>{void redeemShare?.('second-code');}}>Accept second</button>
    <button type="button" onClick={()=>selectCase?.('case-one')}>Open first</button>
  </div>;
}

function reviewCase(revision:number,hash='a'.repeat(64)) {
  return {id:'case-one',company:'Acme',revision,current_packet_id:'packet-one',
    packets:[{id:'packet-one',version:1,hash,stage:'in_review',created_at:'2026-10-03T00:00:00Z'}],
    sources:[],tasks:[],flags:[],jobs:[],facts:{},messages:[],status:'In review',ui_state:'Idle'};
}

describe('server case selection', () => {
  it('selects a newly redeemed second case and keeps the first accessible',async()=>{
    session.role='advisor';
    const first={id:'case-one',company:'Harbor',revision:1,packets:[],sources:[]};
    const second={id:'case-two',company:'Cedar',revision:1,packets:[],sources:[]};
    let accepted=false;
    api.listServerCases.mockImplementation(async()=>accepted?[first,second]:[first]);
    api.getServerCase.mockImplementation(async(id:string)=>id==='case-two'?second:first);
    api.mapServerCase.mockImplementation((state:{id:string})=>({id:state.id,packets:[],sources:[]}));
    api.redeemServerShare.mockImplementation(async()=>{accepted=true;return {case_id:'case-two'};});
    render(<ServerRelayProvider role="advisor"><AdditionalInvitationProbe/></ServerRelayProvider>);
    await screen.findByText('case-one:case-one:case-one');
    fireEvent.click(screen.getByRole('button',{name:'Accept second'}));
    await screen.findByText('case-two:case-two:case-one,case-two');
    expect(localStorage.getItem('relay-selected-workflow-case')).toBe('case-two');
    fireEvent.click(screen.getByRole('button',{name:'Open first'}));
    await screen.findByText('case-one:case-one:case-one,case-two');
  });
  it('keeps the current snapshot when the same case is opened repeatedly', async () => {
    const state={id:'new-case',company:'Acme',revision:2,sources:[],packets:[]};
    localStorage.setItem('relay-selected-workflow-case','new-case');
    api.listServerCases.mockResolvedValue([state]);
    api.getServerCase.mockResolvedValue(state);
    api.mapServerCase.mockImplementation(()=>({id:'new-case',company:'Acme',packets:[],sources:[]}));
    render(<ServerRelayProvider role="founder"><Probe/></ServerRelayProvider>);
    await screen.findByText('new-case:new-case');
    fireEvent.click(screen.getByRole('button',{name:'Open current case'}));
    fireEvent.click(screen.getByRole('button',{name:'Open current case'}));
    expect(screen.getByText('new-case:new-case')).toBeTruthy();
    expect(api.getServerCase).toHaveBeenCalledTimes(1);
  });

  it('selects a newly created case and loads its authoritative snapshot', async () => {
    const created = { id: 'new-case', company: 'Acme', revision: 0, sources: [], packets: [] };
    let exists = false;
    api.listServerCases.mockImplementation(async () => exists ? [created] : []);
    api.createServerCase.mockImplementation(async () => {exists = true;return created;});
    api.getServerCase.mockResolvedValue(created);
    api.mapServerCase.mockImplementation(() => ({ id: 'new-case', company: 'Acme', packets: [], sources: [] }));
    render(<ServerRelayProvider role="founder"><Probe/></ServerRelayProvider>);
    await screen.findByText('none:none');
    fireEvent.click(screen.getByRole('button', {name:'Create'}));
    await screen.findByText('new-case:new-case');
    expect(localStorage.getItem('relay-selected-workflow-case')).toBe('new-case');
    await waitFor(() => expect(api.getServerCase).toHaveBeenCalledWith('new-case', expect.any(AbortSignal)));
  });

  it('retries an invite once after cloud sync changes only the case revision and keeps its code visible', async () => {
    localStorage.setItem('relay-selected-workflow-case','case-one');
    const initial=reviewCase(3);
    const synced=reviewCase(4);
    api.listServerCases.mockResolvedValue([initial]);
    api.getServerCase.mockResolvedValueOnce(initial).mockResolvedValue(synced);
    api.mapServerCase.mockImplementation(state=>({id:state.id,revision:state.revision,
      current_packet_version_id:state.current_packet_id,packets:state.packets,sources:[]}));
    api.createServerShare.mockRejectedValueOnce(new WorkflowRequestError('stale',409,'STALE_REVISION'))
      .mockResolvedValueOnce({id:'invite-one',invite_code:'ephemeral-invite-code'});
    render(<ServerRelayProvider role="founder"><SharingProbe/></ServerRelayProvider>);
    await screen.findByText('3');
    fireEvent.click(screen.getByRole('button',{name:'Invite'}));
    await screen.findByText('ephemeral-invite-code');
    await waitFor(()=>expect(api.createServerShare).toHaveBeenCalledTimes(2));
    const first=api.createServerShare.mock.calls[0];
    const second=api.createServerShare.mock.calls[1];
    expect(first[2]).toBe(3);
    expect(second[2]).toBe(4);
    expect(second[4]).toBe(first[4]);
    await screen.findByText('4');
    expect(screen.getByText('ephemeral-invite-code')).toBeTruthy();
  });

  it('retries an advisor review only while the same packet and hash remain current', async () => {
    session.role='advisor';
    localStorage.setItem('relay-selected-workflow-case','case-one');
    const initial=reviewCase(3);
    const synced=reviewCase(4);
    api.listServerCases.mockResolvedValue([initial]);
    api.getServerCase.mockResolvedValueOnce(initial).mockResolvedValue(synced);
    api.mapServerCase.mockImplementation(state=>({id:state.id,revision:state.revision,
      current_packet_version_id:state.current_packet_id,packets:state.packets,sources:[]}));
    api.reviewServerPacket.mockRejectedValueOnce(new WorkflowRequestError('stale',409,'STALE_REVISION'))
      .mockResolvedValueOnce(undefined);
    render(<ServerRelayProvider role="advisor"><SharingProbe/></ServerRelayProvider>);
    await screen.findByText('3');
    fireEvent.click(screen.getByRole('button',{name:'Review'}));
    await waitFor(()=>expect(api.reviewServerPacket).toHaveBeenCalledTimes(2));
    expect(api.reviewServerPacket.mock.calls[0][2]).toBe(3);
    expect(api.reviewServerPacket.mock.calls[1][2]).toBe(4);
    expect(api.reviewServerPacket.mock.calls[1][5]).toBe(api.reviewServerPacket.mock.calls[0][5]);
  });

  it('does not retry sharing when a newer packet replaced the selected version', async () => {
    localStorage.setItem('relay-selected-workflow-case','case-one');
    const initial=reviewCase(3);
    const changed={...reviewCase(4),current_packet_id:'packet-two'};
    api.listServerCases.mockResolvedValue([initial]);
    api.getServerCase.mockResolvedValueOnce(initial).mockResolvedValue(changed);
    api.mapServerCase.mockImplementation(state=>({id:state.id,revision:state.revision,
      current_packet_version_id:state.current_packet_id,packets:state.packets,sources:[]}));
    api.createServerShare.mockRejectedValueOnce(new WorkflowRequestError('stale',409,'STALE_REVISION'));
    render(<ServerRelayProvider role="founder"><SharingProbe/></ServerRelayProvider>);
    await screen.findByText('3');
    fireEvent.click(screen.getByRole('button',{name:'Invite'}));
    await waitFor(()=>expect(api.createServerShare).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(screen.getByText(/This packet changed/)).toBeTruthy());
  });
});
