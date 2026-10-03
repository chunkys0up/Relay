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
  presence?: (attendeeId: string, present: boolean) => void;
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

function publicCameraError(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : null;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was denied. Allow it in your browser settings, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found. Connect a camera and try again.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The camera is in use by another app. Close it, then try again.';
  return 'Could not use the camera. Check camera permission and try again.';
}

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach(track => track.stop());
}

async function dispose(handle: SessionHandle): Promise<void> {
  if (handle.connectionTimer !== null) window.clearTimeout(handle.connectionTimer);
  const av = handle.meeting.audioVideo;
  try { av.removeObserver(handle.observer); } catch { /* already removed */ }
  if (handle.presence) try { av.realtimeUnsubscribeToAttendeeIdPresence(handle.presence); } catch { /* already removed */ }
  // Each cleanup step gets a chance even when a device or SDK method fails.
  try { av.stopLocalVideoTile(); } catch { /* already stopped */ }
  try { av.stop(); } catch { /* already stopped */ }
  try { av.unbindAudioElement(); } catch { /* already unbound */ }
  await Promise.allSettled([
    Promise.resolve().then(() => av.stopVideoInput()),
    Promise.resolve().then(() => av.stopAudioInput()),
  ]);
}

const iconProps = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const MicIcon = (): ReactNode => <svg {...iconProps}><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/></svg>;
const MicOffIcon = (): ReactNode => <svg {...iconProps}><path d="M15 9.3V5a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.9 2.3M5 10a7 7 0 0 0 11.6 5.3M19 10a7 7 0 0 1-.6 2.8M12 17v5M3 3l18 18"/></svg>;
const CameraIcon = (): ReactNode => <svg {...iconProps}><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/></svg>;
const CameraOffIcon = (): ReactNode => <svg {...iconProps}><path d="M10.7 6H14a2 2 0 0 1 2 2v3.3l1 1 5-2.3v10M16 16v0a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2M3 3l18 18"/></svg>;
const LeaveIcon = (): ReactNode => <svg {...iconProps}><path d="M10.7 13.3a16 16 0 0 0 3.4 2.6l1.3-1.3a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3 4.2 2 2 0 0 1 5 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8.8 9.7M22 2 2 22"/></svg>;

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
  // The other person's presence, mute state and whether each side is talking, from Chime's realtime signals.
  const [remotePresent, setRemotePresent] = useState(false);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [remoteSpeaking, setRemoteSpeaking] = useState(false);
  const [selfSpeaking, setSelfSpeaking] = useState(false);
  // Camera preview before joining; its stream carries into the call.
  const [previewOn, setPreviewOn] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const phaseRef = useRef<Phase>('idle');
  const mounted = useRef(true);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const callId = useRef<string | null>(null);
  const session = useRef<SessionHandle | null>(null);
  const cameraChanging = useRef(false);
  const cameraStream = useRef<MediaStream | null>(null);
  const localTileId = useRef<number | null>(null);
  const onActiveChangeRef = useRef(onActiveChange);
  const audioEl = useRef<HTMLAudioElement>(null);
  const localEl = useRef<HTMLVideoElement>(null);
  const remoteEl = useRef<HTMLVideoElement>(null);
  const previewEl = useRef<HTMLVideoElement>(null);
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
    // Stop our own camera tracks too, so the camera light turns off as soon as the call closes.
    stopTracks(cameraStream.current);
    cameraStream.current = null;
    localTileId.current = null;
    cameraChanging.current = false;
    if (mounted.current) {
      phaseRef.current = next;
      setPhaseState(next);
      setCameraOn(false);
      setCameraBusy(false);
      setRemoteTile(null);
      setRemotePresent(false);
      setRemoteMuted(false);
      setRemoteSpeaking(false);
      setSelfSpeaking(false);
      setPreviewOn(false);
      setMicrophoneReady(false);
      setMicrophoneNotice(null);
      setMuted(false);
      setEnding(false);
      setNotice(message);
    }
  }, []);

  // Chime binds a tile to its <video> once; rebind after the element is shown again.
  useEffect(() => {
    if (phase !== 'live' || !cameraOn || localTileId.current === null || !localEl.current) return;
    session.current?.meeting.audioVideo.bindVideoElement(localTileId.current, localEl.current);
  }, [phase, cameraOn]);

  useEffect(() => {
    if (phase !== 'live' || remoteTile === null || !remoteEl.current) return;
    session.current?.meeting.audioVideo.bindVideoElement(remoteTile, remoteEl.current);
  }, [phase, remoteTile]);

  useEffect(() => {
    if (previewEl.current) previewEl.current.srcObject = previewOn ? cameraStream.current : null;
  }, [previewOn, phase]);

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
          // A camera turned on in the preview starts sending as soon as the call connects.
          if (cameraStream.current) void toggleCamera();
        },
        audioVideoDidStop: () => {
          if (!current()) return;
          closeLocal('ended', 'The live connection ended.');
        },
        videoTileDidUpdate: tile => {
          if (!current() || tile.tileId === null || tile.tileId === undefined || tile.isContent) return;
          if (tile.localTile) localTileId.current = tile.tileId;
          const element = tile.localTile ? localEl.current : remoteEl.current;
          if (element) av.bindVideoElement(tile.tileId, element);
          if (!tile.localTile) setRemoteTile(tile.active ? tile.tileId : null);
        },
        videoTileWasRemoved: tileId => {
          if (current()) setRemoteTile(previous => previous === tileId ? null : previous);
        },
      };
      av.addObserver(handle.observer);
      const selfId = (joined.attendee as { AttendeeId?: string }).AttendeeId;
      if (selfId) av.realtimeSubscribeToVolumeIndicator(selfId, (_id, volume) => { if (current() && volume !== null) setSelfSpeaking(volume > 0.1); });
      handle.presence = (attendeeId, present) => {
        if (!current() || attendeeId === selfId || attendeeId.includes('#content')) return;
        setRemotePresent(present);
        if (present) {
          av.realtimeSubscribeToVolumeIndicator(attendeeId, (_id, volume, isMuted) => {
            if (!current()) return;
            if (isMuted !== null) setRemoteMuted(isMuted);
            if (volume !== null) setRemoteSpeaking(volume > 0.1);
          });
        } else {
          av.realtimeUnsubscribeFromVolumeIndicator(attendeeId);
          setRemoteMuted(false);
          setRemoteSpeaking(false);
        }
      };
      av.realtimeSubscribeToAttendeeIdPresence(handle.presence);

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
        stopTracks(cameraStream.current);
        cameraStream.current = null;
      } else {
        // Ask the browser for the camera directly (or reuse the preview's stream). Listing devices before
        // permission is granted returns an empty device ID, which Chime silently ignores, so the camera never starts.
        const stream = cameraStream.current ?? await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (!current()) { stopTracks(stream); return; }
        cameraStream.current = stream;
        await av.startVideoInput(stream);
        if (!current()) {
          await av.stopVideoInput();
          stopTracks(stream);
          return;
        }
        av.startLocalVideoTile();
        setCameraOn(true);
      }
    } catch (cause) {
      if (current()) {
        setCameraOn(false);
        try { av.stopLocalVideoTile(); } catch { /* already stopped */ }
        try { await av.stopVideoInput(); } catch { /* already stopped */ }
        stopTracks(cameraStream.current);
        cameraStream.current = null;
        setError(publicCameraError(cause));
      }
    } finally {
      if (current()) {
        cameraChanging.current = false;
        setCameraBusy(false);
      }
    }
  };

  const inCall = (): boolean => phaseRef.current === 'starting' || phaseRef.current === 'live';

  const togglePreview = async (): Promise<void> => {
    if (previewBusy || inCall()) return;
    setError(null);
    if (previewOn) {
      stopTracks(cameraStream.current);
      cameraStream.current = null;
      setPreviewOn(false);
      return;
    }
    setPreviewBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (!mounted.current || inCall()) { stopTracks(stream); return; }
      cameraStream.current = stream;
      setPreviewOn(true);
    } catch (cause) {
      if (mounted.current) setError(publicCameraError(cause));
    } finally {
      if (mounted.current) setPreviewBusy(false);
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
      <div className="relay-call-stage">
        <div className={`relay-call-tile ${live && remoteTile !== null ? 'has-video' : ''} ${remotePresent && remoteSpeaking && !remoteMuted ? 'is-speaking' : ''}`}>
          <video ref={remoteEl} playsInline autoPlay/>
          {!(live && remoteTile !== null) && <span className={'relay-call-tile-avatar ' + other.role} aria-hidden="true">{initials(other.name)}</span>}
          <span className="relay-call-tile-label">
            {remotePresent && remoteMuted && <span className="relay-call-muted" title="Muted"><MicOffIcon/><span className="sr-only">Muted</span></span>}
            <strong>{other.name}</strong>
            {!live ? <small>Connecting…</small> : !remotePresent ? <small>Not joined yet</small> : remoteTile === null ? <small>Camera off</small> : null}
          </span>
        </div>
        <div className={`relay-call-tile is-self ${live && cameraOn ? 'has-video' : ''} ${selfSpeaking && !muted ? 'is-speaking' : ''}`}>
          <video ref={localEl} muted playsInline autoPlay/>
          {!(live && cameraOn) && <span className={'relay-call-tile-avatar ' + actor.role} aria-hidden="true">{initials(actor.name)}</span>}
          <span className="relay-call-tile-label">
            {microphoneReady && muted && <span className="relay-call-muted" title="Muted"><MicOffIcon/><span className="sr-only">Muted</span></span>}
            <strong>You</strong>{!cameraOn && <small>Camera off</small>}
          </span>
        </div>
      </div>
      {microphoneNotice && <p role="status" className="relay-call-status">{microphoneNotice}</p>}
      {phase === 'starting' && <p role="status" className="relay-call-status">Connecting to Chime. Your camera is off.</p>}
      <div className="relay-call-controls">
        <button type="button" className={`relay-call-control ${muted ? 'is-off' : ''}`} disabled={!live || !microphoneReady || ending} onClick={toggleMute} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} title={muted ? 'Unmute' : 'Mute'}>{muted ? <MicOffIcon/> : <MicIcon/>}</button>
        <button type="button" className={`relay-call-control ${cameraOn ? '' : 'is-off'}`} disabled={!live || cameraBusy || ending} onClick={() => { void toggleCamera(); }} aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'} title={cameraOn ? 'Turn camera off' : 'Turn camera on'}>{cameraOn ? <CameraIcon/> : <CameraOffIcon/>}</button>
        <button type="button" className="relay-call-control is-leave" onClick={() => closeLocal('ended', phase === 'starting' ? 'Connection attempt cancelled.' : ending ? 'You left this device. The request to end for everyone may still complete.' : 'You left the call. Others may still be connected.')} aria-label={phase === 'starting' ? 'Cancel' : 'Leave call'} title={phase === 'starting' ? 'Cancel' : 'Leave call'}><LeaveIcon/></button>
      </div>
      {live && <button type="button" className="relay-call-end-link" disabled={ending} onClick={() => { void endForEveryone(); }}>{ending ? 'Ending…' : 'End call for everyone'}</button>}
    </> : <>
      <h2>Ready to call?</h2>
      <div className="relay-call-recipient"><span className={'relay-call-avatar ' + other.role}>{initials(other.name)}</span><div><strong>{other.name}</strong><span>{role === 'founder' ? 'Your financial advisor' : 'Client · ' + snapshot.company}</span></div></div>
      <div className="relay-call-preview-heading"><h3>Your camera preview</h3><span>{previewOn ? 'Camera on' : 'Camera off'}</span></div>
      <div className={`relay-call-tile is-self ${previewOn ? 'has-video' : ''}`}>
        <video ref={previewEl} muted playsInline autoPlay/>
        {!previewOn && <span className={'relay-call-tile-avatar ' + actor.role} aria-hidden="true">{initials(actor.name)}</span>}
        <span className="relay-call-tile-label"><strong>{actor.name} · You</strong>{!previewOn && <small>Camera off</small>}</span>
        <button type="button" className={`relay-call-control relay-call-preview-toggle ${previewOn ? '' : 'is-off'}`} disabled={previewBusy} onClick={() => { void togglePreview(); }} aria-label={previewOn ? 'Turn camera off' : 'Turn camera on'} title={previewOn ? 'Turn camera off' : 'Turn camera on'}>{previewOn ? <CameraIcon/> : <CameraOffIcon/>}</button>
      </div>
      <p className="relay-call-disclaimer">A running backend with AWS Chime access is required. Joining uses your microphone if available. Your camera joins on only if you turn it on here.</p>
      <div className="relay-call-invite"><Button onClick={() => { void start(); }}>{phase === 'ended' ? 'Start or rejoin live call' : 'Start or join live call'}</Button><span>No invitation is sent. The other person must open live call and join.</span></div>
    </>}
    <p className="relay-call-disclaimer">Live Chime media. This panel does not record or transcribe the call.</p>
  </section>;
}
