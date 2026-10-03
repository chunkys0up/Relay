import { useState } from 'react';
import { Button, Panel } from './ui';
import { useRelay } from './context';

export default function ServerInvitationAcceptance() {
  const {busy,redeemShare,error,notice}=useRelay();
  const [code,setCode]=useState('');
  return <Panel title="Accept a packet invitation">
    <p>Use an invitation code from the founder in this separate browser session. A role switch in the founder session does not grant access.</p>
    <form onSubmit={event=>{
      event.preventDefault();
      if(!code.trim()||busy||!redeemShare)return;
      void redeemShare(code.trim()).then(accepted=>{if(accepted)setCode('');});
    }}>
      <label>Invitation code<input value={code} onChange={event=>setCode(event.target.value)} required autoComplete="off"/></label>
      <Button type="submit" disabled={busy||!code.trim()}>Accept invitation</Button>
    </form>
    {error&&<p role="alert">{error}</p>}
    {notice&&<p role="status">{notice}</p>}
  </Panel>;
}
