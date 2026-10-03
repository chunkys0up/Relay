import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useRelay } from './context';
import { Badge, PageTitle, Panel } from './ui';
import { Tabs } from './tabs';

const sections=[{id:'profile',label:'Profile'},{id:'privacy',label:'Call privacy'},{id:'about',label:'About this demo'}] as const;
export default function Settings():ReactNode {
  const {snapshot,role,mode}=useRelay();const [params,setParams]=useSearchParams();
  const active=sections.find(item=>item.id===params.get('section'))?.id??'profile';
  if(!snapshot)return null;
  if(mode==='server')return <section className="utility-page"><PageTitle title="Settings" subtitle="Workflow session and storage status."/>
   <div className="settings-layout"><Panel title="Local workflow session"><p>The role selector is a read-only preview choice. It does not sign in an advisor or share this case.</p><dl className="settings-details"><div><dt>Case</dt><dd>{snapshot.company}</dd></div><div><dt>Packet stage</dt><dd>{snapshot.status}</dd></div><div><dt>Legacy service sync</dt><dd>{snapshot.server_legacy_sync_status??'unconfigured'}</dd></div></dl><Link className="button button-outline" to={'/'+role+'/documents'}>View packet PDFs</Link></Panel><aside><Panel title="Storage"><p>Original files and packet PDFs are saved through the workflow backend. Each file shows its cloud status in Documents. Advisor access and live calls require authenticated sharing that this owner session does not provide.</p></Panel></aside></div>
  </section>;
  const actor=role==='founder'?snapshot.founder:snapshot.advisors[0];
  const participant=snapshot.call?.participants.find(item=>item.actor.id===actor.id);
  return <section className="utility-page"><PageTitle title="Settings" subtitle="Your workspace identity and call privacy."/>
    <div className="settings-layout"><Panel><Tabs id="settings" label="Settings sections" items={sections} value={active} onChange={section=>setParams({section})}/>
      <div className="settings-content" id={`settings-${active}-panel`} role="tabpanel" aria-labelledby={`settings-${active}-tab`} tabIndex={0}>
        {active==='profile'&&<><h2>Workspace profile</h2><Badge>Synthetic identity</Badge><dl className="settings-details"><div><dt>Name</dt><dd>{actor.name}</dd></div><div><dt>Role</dt><dd>{role==='founder'?'Founder':'Advisor'}</dd></div><div><dt>Company</dt><dd>{snapshot.company}</dd></div></dl><p>This profile belongs to the synthetic browser workspace. Account sign-in and profile editing are not implemented; the demo role selector changes the local view only.</p></>}
        {active==='privacy'&&<><h2>Separate consent for every call</h2><p>Joining a call does not allow recording or AI notes. Recording and transcription controls are not available in this design. Joining and messaging never enable capture.</p><dl className="settings-details"><div><dt>Your current consent</dt><dd>{participant?participant.capture_consent.replaceAll('_',' '):'Not given · no call session'}</dd></div><div><dt>Capture</dt><dd>{snapshot.call?.capture.replaceAll('_',' ')??'Off'}</dd></div></dl><p>Demo preview uses no camera or microphone. Amazon Chime mode can use your microphone and, when explicitly enabled, camera. Recording and transcription are unavailable in both modes.</p><Link className="button button-primary" to={`/${role}/call`}>Open Call</Link></>}
        {active==='about'&&<><h2>About this demo</h2><p>The workspace starts with fictional sources and people. Sources added through the browser demo Sources screen and browser demo actions are retained in this browser across reloads and shared with same-origin tabs.</p><p>In browser demo Sources, only UTF-8 text and CSV extraction run locally. PDF and binary originals there are retained with extraction marked unsupported. Founder Home originals and AI Chat attachments use the legacy backend; private founder AI uses its chat service. Amazon Chime provides live media when explicitly selected and connected. The backend packet workspace and server synthetic advisor workspace each keep separate server state. Previewing a human message does not send it; confirmed delivery remains simulated.</p><Link className="button button-outline" to={`/${role}/documents`}>Explore documents</Link></>}
      </div></Panel><aside><Panel title="Workspace storage"><Badge>Browser and service data</Badge><p>Browser packet versions and human messages are stored locally. Legacy uploads, checklist and activity use backend storage; the separate server workspaces persist their own data. A browser document handoff shares only its selected version and originals within the demo.</p><Link to={`/${role}/${role==='founder'?'home':'home'}`}>Return to workspace</Link></Panel></aside></div>
  </section>;
}
