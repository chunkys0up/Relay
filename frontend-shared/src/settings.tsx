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
  const documentsPath=role==='founder'?'/founder/call':'/advisor/clients';
  return <section className="utility-page"><PageTitle title="Settings" subtitle="Your workspace identity and call privacy."/>
    <div className="settings-layout"><Panel><Tabs id="settings" label="Settings sections" items={sections} value={active} onChange={section=>setParams({section})}/>
      <div className="settings-content" id={`settings-${active}-panel`} role="tabpanel" aria-labelledby={`settings-${active}-tab`} tabIndex={0}>
        {active==='profile'&&<><h2>Workspace profile</h2><Badge>Demo identity</Badge><dl className="settings-details"><div><dt>Name</dt><dd>{actor.name}</dd></div><div><dt>Role</dt><dd>{role==='founder'?'Founder':'Advisor'}</dd></div><div><dt>Company</dt><dd>{snapshot.company}</dd></div></dl><p>This demo has two fixed people. The role selector in the header switches between them; there is no sign-in yet.</p></>}
        {active==='privacy'&&<><h2>Calls are never recorded</h2><p>Calls run live on Amazon Chime. Nothing is recorded or transcribed, and no AI listens in. Your camera stays off until you turn it on, before or during a call.</p><dl className="settings-details"><div><dt>Recording</dt><dd>Off</dd></div><div><dt>Transcription</dt><dd>Off</dd></div></dl><Link className="button button-primary" to={`/${role}/call`}>Open Call</Link></>}
        {active==='about'&&<><h2>About this demo</h2><p>Files and packet PDFs are stored in Amazon S3, and the case, checklist, activity, chats and reviews are saved in PostgreSQL, so changes show up for both people.</p><p>Relay, the AI assistant, runs on Amazon Bedrock. It can read the case&apos;s files and, when asked, edit text files, rewrite the packet summary, or create a new packet version. Every edit keeps the earlier version.</p><Link className="button button-outline" to={documentsPath}>Open documents</Link></>}
      </div></Panel><aside><Panel title="What's shared"><Badge>Saved to the backend</Badge><p>Your AI chats with Relay are private to you. Messages, files, packets and reviews are shared between the founder and the advisor.</p><Link to={`/${role}/home`}>Return to workspace</Link></Panel></aside></div>
  </section>;
}
