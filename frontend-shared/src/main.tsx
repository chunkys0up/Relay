import { StrictMode, Suspense, lazy, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { RelayProvider, useRelay } from './context';
import { Button, Icon, ScreenState } from './ui';
import type { Role } from './types';
import './styles.css';
const Search=lazy(()=>import('./search'));
const Settings=lazy(()=>import('./settings'));
const Home=lazy(()=>import('../../client-frontend/src/home/Screen'));
const Chat=lazy(()=>import('../../client-frontend/src/chat/Screen'));
const AdvisorHome=lazy(()=>import('../../advsior-frontend/src/home/Screen'));
const Sources=lazy(()=>import('../../client-frontend/src/sources/Screen'));
const FounderDocuments=lazy(()=>import('../../client-frontend/src/documents/Screen'));
const FounderCall=lazy(()=>import('../../client-frontend/src/call/Screen'));
const Clarification=lazy(()=>import('../../client-frontend/src/clarification/Screen'));
const Clients=lazy(()=>import('../../advsior-frontend/src/clients/Screen'));
const Reviews=lazy(()=>import('../../advsior-frontend/src/reviews/Screen'));
const AdvisorDocuments=lazy(()=>import('../../advsior-frontend/src/documents/Screen'));
const AdvisorCall=lazy(()=>import('../../advsior-frontend/src/call/Screen'));
const shortcutLabel=typeof navigator!=='undefined'&&/Mac|iPhone|iPad/.test(navigator.platform)?'⌘K':'Ctrl K';
const founderNav=[['home','Home','home'],['chat','AI Chat','agent'],['call','Documents','file']] as const;
const advisorNav=[['home','Home','home'],['clients','Clients','clients'],['call','Call','call']] as const;
function Shell():ReactNode{
 const {role,snapshot,busy,error,notice,cancel}=useRelay();const navigate=useNavigate();const {pathname}=useLocation();const mainRef=useRef<HTMLElement>(null);useEffect(()=>{if(mainRef.current)mainRef.current.scrollTop=0;},[pathname]);
 // ⌘K / Ctrl+K jumps to the header search from anywhere.
 useEffect(()=>{const onKey=(e:KeyboardEvent):void=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();document.querySelector<HTMLInputElement>('.global-search input')?.focus();}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);
const nav=role==='founder'?founderNav:advisorNav;const actor=role==='founder'?'Alex Morgan':'Maya Chen';
 return <><a className="skip-link" href="#main-content">Skip to main content</a><header className="topbar"><Link className="brand-mark" to={`/${role}/${nav[0][0]}`} aria-label="Relay home">R<span/></Link><strong className="brand-name">Relay</strong><form className="global-search" onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);navigate(`/${role}/${'search'}?q=${encodeURIComponent(String(data.get('q')??''))}`);}}><Icon name="search" size={18}/><input name="q" aria-label="Search sources and drafts" placeholder="Search sources and drafts"/><kbd aria-hidden="true">{shortcutLabel}</kbd><button type="submit" className="sr-only">Search</button></form><Link className="mobile-search" to={`/${role}/search`} aria-label="Search sources and drafts"><Icon name="search" size={18}/></Link><select className="topbar-role" value={role} aria-label="Demo role" onChange={e=>navigate(e.target.value==='founder'?'/founder/home':'/advisor/home')}><option value="founder">Founder · Alex</option><option value="advisor">Advisor · Maya</option></select><span className="company-label">Northstar Labs</span><span className="avatar" aria-label={actor}>{role==='founder'?'AM':'MC'}</span></header><aside className="navigation" aria-label={`${role} navigation`}><nav>{nav.map(([path,label,icon])=><NavLink key={path} to={`/${role}/${path}`}><Icon name={icon}/><span>{label}</span></NavLink>)}</nav><NavLink className="settings-link" to={`/${role}/settings`}><Icon name="settings" size={23}/><span>Settings</span></NavLink><span className="avatar">{role==='founder'?'AM':'MC'}</span><div className="nav-identity"><strong>{actor}</strong><small>{role==='founder'?snapshot?.company:'Financial advisor'}</small></div></aside><main id="main-content" ref={mainRef} tabIndex={-1}>{(error||notice||busy)&&<div className={`feedback ${error?'feedback-error':''}`} role={error?'alert':'status'}>{busy?'Waiting for simulated result…':error??notice}{busy&&<Button variant="outline" onClick={cancel}>Cancel request</Button>}</div>}<ScreenState><Suspense fallback={<p role="status">Loading screen…</p>}><Routes>{role==='founder'?<><Route path="/founder/home" element={<Home/>}/><Route path="/founder/chat" element={<Chat/>}/><Route path="/founder/home/clarification" element={<Clarification/>}/><Route path="/founder/sources" element={<Sources/>}/><Route path="/founder/documents" element={<FounderDocuments/>}/><Route path="/founder/call" element={<FounderCall/>}/></>:<><Route path="/advisor/home" element={<AdvisorHome/>}/><Route path="/advisor/clients" element={<Clients/>}/><Route path="/advisor/reviews" element={<Reviews/>}/><Route path="/advisor/documents" element={<AdvisorDocuments/>}/><Route path="/advisor/call" element={<AdvisorCall/>}/></>}<Route path={`/${role}/settings`} element={<Settings/>}/><Route path={`/${role}/search`} element={<Search/>}/><Route path="*" element={<Navigate replace to={`/${role}/${nav[0][0]}`}/>}/></Routes></Suspense></ScreenState><footer className="app-footer">Fictional planning packet · No financial advice · {snapshot?`Case revision ${snapshot.revision}`:'Workspace unavailable'}</footer></main></>;
}
function App():ReactNode{const location=useLocation();const role:Role=location.pathname.startsWith('/advisor')?'advisor':'founder';return <RelayProvider role={role} key={role}><Shell/></RelayProvider>;}
createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App/></BrowserRouter></StrictMode>);
