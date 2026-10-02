import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useRelay } from './context';
import { Badge, PageTitle, Panel } from './ui';
import { Tabs } from './tabs';

const sections=[{id:'profile',label:'Profile'},{id:'privacy',label:'Call privacy'},{id:'about',label:'About this demo'}] as const;
export default function Settings():ReactNode {
  const {snapshot,role}=useRelay();const [params,setParams]=useSearchParams();
  const active=sections.find(item=>item.id===params.get('section'))?.id??'profile';
  if(!snapshot)return null;
  const actor=role==='founder'?snapshot.founder:snapshot.advisors[0];
  const participant=snapshot.call?.participants.find(item=>item.actor.id===actor.id);
  return <section className="utility-page"><PageTitle title="Settings" subtitle="Your workspace identity and call privacy."/>
    <div className="settings-layout"><Panel><Tabs id="settings" label="Settings sections" items={sections} value={active} onChange={section=>setParams({section})}/>
      <div className="settings-content" id={`settings-${active}-panel`} role="tabpanel" aria-labelledby={`settings-${active}-tab`} tabIndex={0}>
        {active==='profile'&&<><h2>Workspace profile</h2><Badge>Synthetic identity</Badge><dl className="settings-details"><div><dt>Name</dt><dd>{actor.name}</dd></div><div><dt>Role</dt><dd>{role==='founder'?'Founder':'Advisor'}</dd></div><div><dt>Company</dt><dd>{snapshot.company}</dd></div></dl><p>Profile editing and account sign-in will be available when the backend is connected. The demo role selector changes the local view only.</p></>}
        {active==='privacy'&&<><h2>Separate consent for every call</h2><p>Joining a call does not allow recording or AI notes. Each participant must consent separately in the Call workspace, and can withdraw that consent there.</p><dl className="settings-details"><div><dt>Your current consent</dt><dd>{participant?participant.capture_consent.replaceAll('_',' '):'Not given · no call session'}</dd></div><div><dt>Capture</dt><dd>{snapshot.call?.capture.replaceAll('_',' ')??'Off'}</dd></div></dl><p>No camera, microphone, capture or transcription is running in this demo.</p><Link className="button button-primary" to={`/${role}/call`}>Open Call</Link></>}
        {active==='about'&&<><h2>About this demo</h2><p>Sources, drafts and people are fictional. All actions are simulated in memory and reset on a full page reload.</p><p>Uploads, live calls, account settings and saved approvals require backend integration. Previewing a message does not send it; delivery always requires a separate confirmation.</p><Link className="button button-outline" to={`/${role}/documents`}>Explore documents</Link></>}
      </div></Panel><aside><Panel title="Local simulation"><Badge>Nothing saved remotely</Badge><p>Your private AI conversation is separate from messages to a human participant. A document handoff shares only its selected version and originals.</p><Link to={`/${role}/${role==='founder'?'home':'clients'}`}>Return to workspace</Link></Panel></aside></div>
  </section>;
}
