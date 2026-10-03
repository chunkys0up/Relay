import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AudioVideoObserver, DefaultMeetingSession } from 'amazon-chime-sdk-js';
import { callsApi, CallsApiError } from './callsApi';
import { useRelay } from './context';
import { Badge, Button } from './ui';

type Phase = 'idle' | 'starting' | 'live' | 'ended';
interface SessionHandle {
  meeting: DefaultMeetingSession;
  observer: AudioVideoObserver;
  connectionTimer: number | null;
}

function initials(name: string): string {
  return name.split(' ').filter(Boolean).map(part => part[0]).join('');
}

function publicError(error: unknown): string {
  if (error instanceof CallsApiError) {
    if (error.status === 0) return 'Cannot reach the call backend. Start the backend and try again.';
    if (error.status >= 500) return 'The call service is unavailable. Check the backend AWS configuration and try again.';
    return error.message;
  }
  return 'Could not connect to Chime. Check device permissions and try again.';
}

async function dispose(handle: SessionHandle): Promise<void> {
  if (handle.connectionTimer !== null) window.clearTimeout(handle.connectionTimer);
  const av = handle.meeting.audioVideo;
  try { av.removeObserver(handle.observer); } catch { /* already removed */ }
  // Each cleanup step gets a chance even when a device or SDK method fails.
  try { av.stopLocalVideoTile(); } catch { /* already stopped */ }
  try { av.stop(); } catch { /* already stopped */ }
  try { av.unbindAudioElement(); } catch { /* already unbound */ }
  await Promise.allSettled([
    Promise.resolve().then(() => av.stopVideoInput()),
    Promise.resolve().then(() => av.stopAudioInput()),
  ]);
}

/** Live Chime media. Joining never enables the camera or records/transcribes media. */
export function LiveCall({ onActiveChange }: { onActiveChange?: (active: boolean) => void }): ReactNode {
  const { snapshot, role } = useRelay();
  const actor = snapshot ? (role === 'founder' ? snapshot.founder : snapshot.advisors[0]) : null;
  const other = snapshot ? (role === 'founder' ? snapshot.advisors[0] : snapshot.founder) : null;
  const caseId = snapshot?.id ?? null;
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [microphoneNotice, setMicrophoneNotice] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [remoteTile, setRemoteTile] = useState<number | null>(null);
  const [ending, setEnding] = useState(false);
  const phaseRef = useRef<Phase>('idle');
  const mounted = useRef(true);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const callId = useRef<string | null>(null);
  const session = useRef<SessionHandle | null>(null);
  const cameraChanging = useRef(false);
  const onActiveChangeRef = useRef(onActiveChange);
  const audioEl = useRef<HTMLAudioElement>(null);
  const localEl = useRef<HTMLVideoElement>(null);
  const remoteEl = useRef<HTMLVideoElement>(null);
  onActiveChangeRef.current = onActiveChange;

  const setPhase = (next: Phase): void => {
    phaseRef.current = next;
    if (mounted.current) setPhaseState(next);
  };

  useEffect(() => {
    onActiveChangeRef.current?.(phase === 'starting' || phase === 'live');
  }, [phase]);

  const closeLocal = useCallback((next: Phase, message: string | null): void => {
    generation.current += 1;
    request.current?.abort();
    request.current = null;
    const current = session.current;
    session.current = null;
    if (current) void dispose(current);
    cameraChanging.current = false;
    if (mounted.current) {
      phaseRef.current = next;
      setPhaseState(next);
      setCameraOn(false);
      setCameraBusy(false);
      setRemoteTile(null);
      setMicrophoneReady(false);
      setMicrophoneNotice(null);
      setMuted(false);
      setEnding(false);
      setNotice(message);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      closeLocal('idle', null);
      onActiveChangeRef.current?.(false);
    };
  }, [closeLocal]);

  const start = async (): Promise<void> => {
    if (!actor || !caseId || phaseRef.current === 'starting' || phaseRef.current === 'live') return;
    setError(null);
    setNotice(null);
    setMicrophoneNotice(null);
    setPhase('starting');
    const id = ++generation.current;
    const controller = new AbortController();
    request.current = controller;
    const current = (): boolean => mounted.current && generation.current === id;
    try {
      const created = await callsApi.create(caseId, actor, controller.signal);
      if (!current()) return;
      callId.current = created.id;
      const joined = await callsApi.join(caseId, created.id, actor, controller.signal);
      if (!current()) return;
      const sdk = await import('amazon-chime-sdk-js');
      if (!current()) return;
      const logger = new sdk.NoOpLogger();
      const devices = new sdk.DefaultDeviceController(logger);
      // The SDK default asks for audio and video just to reveal device labels.
      // Joining must never request camera permission before the camera button.
      devices.setDeviceLabelTrigger(() => navigator.mediaDevices.getUserMedia({ audio: true, video: false }));
      const meeting = new sdk.DefaultMeetingSession(
        new sdk.MeetingSessionConfiguration(joined.meeting, joined.attendee),
        logger,
        devices,
      );
      const av = meeting.audioVideo;
      const handle: SessionHandle = { meeting, observer: {}, connectionTimer: null };
      session.current = handle;
      handle.observer = {
        audioVideoDidStart: () => {
          if (!current()) return;
          if (handle.connectionTimer !== null) window.clearTimeout(handle.connectionTimer);
          handle.connectionTimer = null;
          setPhase('live');
        },
        audioVideoDidStop: () => {
          if (!current()) return;
          closeLocal('ended', 'The live connection ended.');
        },
        videoTileDidUpdate: tile => {
          if (!current() || tile.tileId === null || tile.tileId === undefined || tile.isContent) return;
          const element = tile.localTile ? localEl.current : remoteEl.current;
          if (element) av.bindVideoElement(tile.tileId, element);
          if (!tile.localTile) setRemoteTile(tile.active ? tile.tileId : null);
        },
        videoTileWasRemoved: tileId => {
          if (current()) setRemoteTile(previous => previous === tileId ? null : previous);
        },
      };
      av.addObserver(handle.observer);

      try {
        const microphones = await av.listAudioInputDevices();
        if (!current()) return;
        if (microphones[0]) {
          await av.startAudioInput(microphones[0].deviceId);
          if (!current()) {
            try { await av.stopAudioInput(); } catch { /* already stopped */ }
            return;
          }
          setMicrophoneReady(true);
        } else {
          setMicrophoneNotice('No microphone is available. You can join and listen.');
        }
      } catch {
        if (!current()) {
          try { await av.stopAudioInput(); } catch { /* already stopped */ }
          return;
        }
        setMicrophoneNotice('Microphone access was denied or unavailable. You can join and listen.');
      }
      if (!current()) return;
      if (audioEl.current) await av.bindAudioElement(audioEl.current);
      if (!current()) return;
      handle.connectionTimer = window.setTimeout(() => {
        if (!current() || phaseRef.current !== 'starting') return;
        setError('Chime did not confirm a connection. Try again.');
        closeLocal('idle', null);
      }, 30000);
      av.start();
    } catch (cause: unknown) {
      if (!current()) return;
      const message = publicError(cause);
      closeLocal('idle', null);
      setError(message);
    } finally {
      if (request.current === controller) request.current = null;
    }
  };

  const toggleMute = (): void => {
    if (!microphoneReady || !session.current || phaseRef.current !== 'live') return;
    try {
      if (muted) session.current.meeting.audioVideo.realtimeUnmuteLocalAudio();
      else session.current.meeting.audioVideo.realtimeMuteLocalAudio();
      setMuted(!muted);
    } catch {
      setError('Could not change the microphone state.');
    }
  };

  const toggleCamera = async (): Promise<void> => {
    const handle = session.current;
    if (!handle || phaseRef.current !== 'live' || cameraChanging.current) return;
    cameraChanging.current = true;
    setCameraBusy(true);
    setError(null);
    const id = generation.current;
    const av = handle.meeting.audioVideo;
    const current = (): boolean => mounted.current && generation.current === id && session.current === handle;
    try {
      if (cameraOn) {
        av.stopLocalVideoTile();
        setCameraOn(false);
        await av.stopVideoInput();
      } else {
        const cameras = await av.listVideoInputDevices();
        if (!current()) return;
        if (!cameras[0]) {
          setError('No camera is available.');
          return;
        }
        await av.startVideoInput(cameras[0].deviceId);
        if (!current()) {
          await av.stopVideoInput();
          return;
        }
        av.startLocalVideoTile();
        setCameraOn(true);
      }
    } catch {
      if (current()) {
        setCameraOn(false);
        try { av.stopLocalVideoTile(); } catch { /* already stopped */ }
        try { await av.stopVideoInput(); } catch { /* already stopped */ }
        setError('Could not use the camera. Check camera permission and try again.');
      }
    } finally {
      if (current()) {
        cameraChanging.current = false;
        setCameraBusy(false);
      }
    }
  };

  const endForEveryone = async (): Promise<void> => {
    if (!actor || !caseId || !session.current || ending) return;
    const id = generation.current;
    setEnding(true);
    setError(null);
    try {
      // The meeting ID stays server-side. Only a successful server response confirms it ended.
      const createdCallId = callId.current;
      if (!createdCallId) throw new Error('Call ID unavailable');
      const result = await callsApi.end(caseId, createdCallId, actor);
      if (!mounted.current || generation.current !== id) return;
      if (result.state !== 'ended') throw new Error('End was not confirmed');
      closeLocal('ended', 'The call ended for everyone.');
    } catch {
      if (mounted.current && generation.current === id) {
        setError('Could not confirm the call ended for everyone. You can retry or leave this device.');
      }
    } finally {
      if (mounted.current && generation.current === id) setEnding(false);
    }
  };

  if (!snapshot || !actor || !other) return null;
  const active = phase === 'starting' || phase === 'live';
  const live = phase === 'live';
  return <section className="relay-call-side-panel" aria-label="Live call controls">
    <div className="relay-call-side-title"><h2>Call · Amazon Chime</h2><Badge tone={live ? 'success' : phase === 'starting' ? 'attention' : 'neutral'}>{live ? 'Connected' : phase === 'starting' ? 'Connecting' : 'Not connected'}</Badge></div>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status" className="relay-call-status">{notice}</p>}
    <audio ref={audioEl} autoPlay />
    {active ? <>
      <div className="relay-call-people">
        <div className="relay-call-person">
          <video ref={localEl} muted playsInline autoPlay style={{ display: live && cameraOn ? 'block' : 'none' }} />
          {!(live && cameraOn) && <span className={'relay-call-avatar ' + actor.role}>{initials(actor.name)}</span>}
          <strong>{actor.name} (You)</strong><span>{cameraOn ? 'Camera on' : 'Camera off'} · {microphoneReady ? muted ? 'Microphone muted' : 'Microphone on' : 'Microphone unavailable'}</span>
        </div>
        <div className="relay-call-person">
          <video ref={remoteEl} playsInline autoPlay style={{ display: live && remoteTile !== null ? 'block' : 'none' }} />
          {!(live && remoteTile !== null) && <span className={'relay-call-avatar ' + other.role}>{initials(other.name)}</span>}
          <strong>{other.name}</strong><span>{live ? remoteTile !== null ? 'Live video' : 'Waiting for video' : 'Connecting to Chime'}</span>
        </div>
      </div>
      {microphoneNotice && <p role="status" className="relay-call-status">{microphoneNotice}</p>}
      {phase === 'starting' && <p role="status" className="relay-call-status">Connecting to Chime. Your camera is off.</p>}
      <div className="relay-call-round-actions">
        <Button variant="outline" disabled={!live || !microphoneReady || ending} onClick={toggleMute} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>{muted ? '♩' : '♬'}<span>{muted ? 'Unmute' : 'Mute'}</span></Button>
        <Button variant="outline" disabled={!live || cameraBusy || ending} onClick={() => { void toggleCamera(); }} aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}>▣<span>{cameraBusy ? 'Changing…' : cameraOn ? 'Camera off' : 'Camera on'}</span></Button>
        <Button variant="outline" onClick={() => closeLocal('ended', phase === 'starting' ? 'Connection attempt cancelled.' : ending ? 'You left this device. The request to end for everyone may still complete.' : 'You left the call. Others may still be connected.')}>{phase === 'starting' ? 'Cancel' : 'Leave'}</Button>
        {live && <Button className="relay-call-end" disabled={ending} onClick={() => { void endForEveryone(); }}>{ending ? 'Ending…' : 'End for everyone'}</Button>}
      </div>
    </> : <>
      <h2>Ready to call?</h2>
      <div className="relay-call-recipient"><span className={'relay-call-avatar ' + other.role}>{initials(other.name)}</span><div><strong>{other.name}</strong><span>{role === 'founder' ? 'Your financial advisor' : 'Client · ' + snapshot.company}</span></div></div>
      <div className="relay-call-preview-heading"><h3>Your camera preview</h3><span>Camera off</span></div>
      <div className="relay-call-self-preview"><span className={'relay-call-avatar large ' + actor.role}>{initials(actor.name)}</span><strong>{actor.name} · You</strong><span>Your camera is off</span></div>
      <p className="relay-call-disclaimer">A running backend with AWS Chime access is required. Joining uses your microphone if available. The camera stays off until you turn it on.</p>
      <div className="relay-call-invite"><Button onClick={() => { void start(); }}>{phase === 'ended' ? 'Start or rejoin live call' : 'Start or join live call'}</Button><span>No invitation is sent. The other person must open live call and join.</span></div>
    </>}
    <p className="relay-call-disclaimer">Live Chime media. This panel does not record or transcribe the call.</p>
  </section>;
}
