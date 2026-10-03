import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Panel } from './ui';
import { useRelay } from './context';
import { confirmServerAnswer, createServerAnswerPreview, discardServerAnswer, getServerCase, serverAnswerPreviewUrl } from './serverPacketApi';
import type { AnswerPreview } from './serverPacketApi';
import type { PacketVersion, Review } from './types';
import { WorkflowRequestError } from '../../client-frontend/src/workflow/api';

export default function ServerReturnedAnswer({caseId,packet,review}: {caseId:string;packet:PacketVersion;review:Review}) {
  const {refresh}=useRelay();
  const navigate=useNavigate();
  const [answer,setAnswer]=useState('');
  const [preview,setPreview]=useState<AnswerPreview|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [created,setCreated]=useState<number|null>(null);
  const exactReview=(state:Awaited<ReturnType<typeof getServerCase>>):boolean=>
    state.current_packet_id===packet.id&&state.packets.some(item=>item.id===packet.id&&item.hash===packet.hash&&item.stage==='questions_returned')
    &&Boolean(state.reviews?.some(item=>item.id===review.id&&item.packet_id===packet.id&&item.packet_hash===packet.hash&&item.decision==='questions_returned'));
  const prepare=async():Promise<void>=>{
    if(!answer.trim()||busy)return;
    setBusy(true);setError(null);setPreview(null);
    const key=crypto.randomUUID();
    try{
      const current=await getServerCase(caseId);
      if(!exactReview(current))throw new Error('The returned review changed. Reload the case before answering.');
      let result:AnswerPreview;
      try{result=await createServerAnswerPreview(caseId,packet,review.id,answer,current.revision,key);}
      catch(reason){
        if(!(reason instanceof WorkflowRequestError)||reason.code!=='STALE_REVISION')throw reason;
        const latest=await getServerCase(caseId);
        if(!exactReview(latest))throw new Error('The returned review changed. Reload the case before answering.');
        result=await createServerAnswerPreview(caseId,packet,review.id,answer,latest.revision,key);
      }
      setPreview(result);
    }catch(reason){setError(reason instanceof Error?reason.message:'Unable to prepare the answer preview.');}
    finally{setBusy(false);}
  };
  const confirm=async():Promise<void>=>{
    if(!preview||busy)return;
    setBusy(true);setError(null);
    const key=crypto.randomUUID();
    try{
      let result:{packet_id:string;packet_hash:string;version:number};
      try{result=await confirmServerAnswer(caseId,preview,preview.case_revision,key);}
      catch(reason){
        if(!(reason instanceof WorkflowRequestError)||reason.code!=='STALE_REVISION')throw reason;
        const latest=await getServerCase(caseId);
        if(!exactReview(latest))throw new Error('The returned review changed. Prepare a new preview before confirming.');
        result=await confirmServerAnswer(caseId,preview,latest.revision,key);
      }
      setCreated(result.version);setPreview(null);refresh();
      navigate(`/founder/documents?version=${encodeURIComponent(result.packet_id)}`);
    }catch(reason){setError(reason instanceof Error?reason.message:'Unable to save the founder response.');}
    finally{setBusy(false);}
  };
  const discard=async():Promise<void>=>{
    if(!preview||busy)return;
    setBusy(true);setError(null);
    const key=crypto.randomUUID();
    try{
      try{await discardServerAnswer(caseId,preview,preview.case_revision,key);}
      catch(reason){
        if(!(reason instanceof WorkflowRequestError)||reason.code!=='STALE_REVISION')throw reason;
        const latest=await getServerCase(caseId);
        await discardServerAnswer(caseId,preview,latest.revision,key);
      }
      setPreview(null);refresh();
    }catch(reason){setError(reason instanceof Error?reason.message:'Unable to discard the preview.');}
    finally{setBusy(false);}
  };
  return <Panel title="Answer returned questions">
    <p>Advisor review <code>{review.id}</code> by <code>{review.reviewer.id}</code> for packet v{packet.version}, SHA-256 <code>{packet.hash}</code>.</p>
    <blockquote>{review.note}</blockquote>
    <p>Your response will be attached as an attributed appendix to a new private PDF draft. Existing packet facts and unresolved source conflicts will remain unchanged. Review them before sharing the new version.</p>
    {created ? <p role="status">Private packet v{created} is ready. Review its PDF and move that new version to review before creating a fresh invitation. <Link to="/founder/documents">Open Documents</Link></p> : <>
      <label>Founder answer<textarea value={answer} maxLength={4000} disabled={busy||Boolean(preview)} onChange={event=>setAnswer(event.target.value)} placeholder="Answer the advisor's question"/></label>
      <Button disabled={busy||Boolean(preview)||!answer.trim()} onClick={()=>{void prepare();}}>Preview answer version</Button>
      {preview&&<div className="confirm-panel"><p>Proposed private packet v{preview.version}, SHA-256 <code>{preview.preview_hash}</code>. Review the PDF before saving.</p>
        <a href={serverAnswerPreviewUrl(caseId,preview.preview_id)} target="_blank" rel="noreferrer">Preview proposed PDF</a>
        <iframe title={`Proposed packet v${preview.version} PDF`} src={serverAnswerPreviewUrl(caseId,preview.preview_id)} width="100%" height="480"/>
        <div className="row wrap"><Button disabled={busy} onClick={()=>{void confirm();}}>Confirm answer and new version</Button><Button variant="outline" disabled={busy} onClick={()=>{void discard();}}>Discard preview</Button></div>
      </div>}
    </>}
    {error&&<p role="alert">{error}</p>}
  </Panel>;
}
