import type { ReactNode } from 'react';
import { LiveCall } from './liveCall';
import './call.css';

export function CallControls({ onLiveActiveChange }: { onLiveActiveChange?: (active: boolean) => void }): ReactNode {
  return <LiveCall onActiveChange={active => onLiveActiveChange?.(active)} />;
}
