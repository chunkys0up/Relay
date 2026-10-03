import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { useRelay } from './context';
import ServerReturnedAnswer from './ServerReturnedAnswer';

const api=vi.hoisted(()=>({getServerCase:vi.fn(),createServerAnswerPreview:vi.fn(),
  discardServerAnswer:vi.fn(),confirmServerAnswer:vi.fn(),serverAnswerPreviewUrl:vi.fn(()=>'/preview.pdf')}));
vi.mock('./context',()=>({useRelay:vi.fn()}));
vi.mock('./serverPacketApi',()=>api);
afterEach(()=>{cleanup();vi.clearAllMocks();});

it('freezes the answer during preview and invalidates a discarded proposal',async()=>{
  const refresh=vi.fn();
  vi.mocked(useRelay).mockReturnValue({refresh} as never);
  const hash='a'.repeat(64);
  const packet={id:'packet-1',version:1,hash,status:'questions_returned'} as never;
  const review={id:'review-1',packet_version_id:'packet-1',packet_hash:hash,
    decision:'questions_returned',note:'Explain revenue.',reviewer:{id:'advisor-1'}} as never;
  api.getServerCase.mockResolvedValue({id:'case-1',revision:4,current_packet_id:'packet-1',
    packets:[{id:'packet-1',hash,stage:'questions_returned'}],
    reviews:[{id:'review-1',packet_id:'packet-1',packet_hash:hash,decision:'questions_returned'}]});
  let completePreview:(value:unknown)=>void=()=>{};
  api.createServerAnswerPreview.mockReturnValue(new Promise(resolve=>{completePreview=resolve;}));
  api.discardServerAnswer.mockResolvedValue(undefined);
  render(<MemoryRouter><ServerReturnedAnswer caseId="case-1" packet={packet} review={review}/></MemoryRouter>);
  const field=screen.getByRole('textbox',{name:'Founder answer'});
  fireEvent.change(field,{target:{value:'Signed contracts explain revenue.'}});
  await userEvent.setup().click(screen.getByRole('button',{name:'Preview answer version'}));
  await waitFor(()=>expect(api.createServerAnswerPreview).toHaveBeenCalledOnce());
  expect(field).toBeDisabled();
  completePreview({preview_id:'preview-1',preview_hash:'b'.repeat(64),packet_id:'packet-1',
    packet_hash:hash,review_id:'review-1',version:2,pages:2,case_revision:5});
  await screen.findByRole('link',{name:'Preview proposed PDF'});
  expect(field).toBeDisabled();
  await userEvent.setup().click(screen.getByRole('button',{name:'Discard preview'}));
  await waitFor(()=>expect(api.discardServerAnswer).toHaveBeenCalledOnce());
  expect(screen.queryByRole('link',{name:'Preview proposed PDF'})).not.toBeInTheDocument();
  expect(field).not.toBeDisabled();
  expect(refresh).toHaveBeenCalledOnce();
});
