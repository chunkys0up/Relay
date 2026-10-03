import type { CaseSnapshot, Role } from './types';

type IdentitySnapshot = Pick<CaseSnapshot, 'company' | 'founder' | 'advisors'> | null;

export interface WorkspaceIdentity {
  founderName: string;
  advisorName: string;
  actorName: string;
  actorInitials: string;
  companyName: string;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('');
}

export function workspaceIdentity(snapshot: IdentitySnapshot, role: Role): WorkspaceIdentity {
  const founderName = snapshot?.founder.name.trim() || 'Founder';
  const advisorName = snapshot?.advisors[0]?.name.trim() || 'Advisor';
  const companyName = snapshot?.company.trim() || 'Demo workspace';
  const actorName = role === 'founder' ? founderName : advisorName;
  return {
    founderName,
    advisorName,
    actorName,
    actorInitials: initials(actorName),
    companyName,
  };
}
