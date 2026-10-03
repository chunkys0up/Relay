import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DefaultMeetingSession } from 'amazon-chime-sdk-js';
import { callsApi, logClient } from './callsApi';
import type { LiveCallSession } from './callsApi';
import { useRelay } from './context';
import { Badge, Button, Panel } from './ui';

type Phase = 'idle' | 'starting' | 'live' | 'ended';
const videoStyle = { width: '100%', aspectRatio: '4 / 3', background: '#0b1b3a', borderRadius: 7, objectFit: 'cover' } as const;

/**
 * Real Amazon Chime call (backend: /api/cases/{id}/calls). Audio/video flow
 * through Chime; capture, recording and transcription are NOT part of this
 * panel and stay off. Open founder and advisor in two tabs to test.
 */
export function LiveCall(): ReactNode {
  const { snapshot, role } = useRelay();
  const [phase, setPhase] = useState<Phase>('idle');
  const [call, setCall] = useState<LiveCallSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [remoteVideo, setRemoteVideo] = useState(false);
  const session = useRef<DefaultMeetingSession | null>(null);
  const callId = useRef<string | null>(null);
  const audioEl = useRef<HTMLAudioElement>(null);
  const localEl = useRef<HTMLVideoElement>(null);
  const remoteEl = useRef<HTMLVideoElement>(null);

  const actor = snapshot ? (role === 'founder' ? snapshot.founder : snapshot.advisors[0]) : null;
  const caseId = snapshot?.id ?? null;

  const leave = useCallback(async (): Promise<void> => {
    const current = session.current;
    session.current = null;
    if (!current) return;
    const av = current.audioVideo;
    try {
      av.stopLocalVideoTile();
      av.unbindAudioElement();
      await av.stopVideoInput();
      await av.stopAudioInput();
      av.stop();
    } catch { /* already stopped */ }
    setCameraOn(false);
    setRemoteVideo(false);
    setMuted(false);
  }, []);

  useEffect(() => () => { void leave(); }, [leave]);

  const start = async (): Promise<void> => {
    if (!actor || !caseId) return;
    setError(null);
    setPhase('starting');
    logClient('start_clicked', role);
    try {
      const created = await callsApi.create(caseId, actor);
      callId.current = created.id;
      logClient('create_ok', role, created.id, `state=${created.state}`);
      const joined = await callsApi.join(caseId, created.id, actor);
      logClient('join_ok', role, created.id, `participants=${joined.call.participants.length}`);
      setCall(joined.call);

      // Load the SDK only when a call starts; it is large.
      const sdk = await import('amazon-chime-sdk-js');
      logClient('sdk_loaded', role, callId.current);
      const logger = new sdk.ConsoleLogger('relay-chime', sdk.LogLevel.WARN);
      const meetingSession = new sdk.DefaultMeetingSession(
        new sdk.MeetingSessionConfiguration(joined.meeting, joined.attendee),
        logger,
        new sdk.DefaultDeviceController(logger),
      );
      const av = meetingSession.audioVideo;
      session.current = meetingSession;

      av.addObserver({
        videoTileDidUpdate: tile => {
          if (!tile.tileId || tile.isContent) return;
          const el = tile.localTile ? localEl.current : remoteEl.current;
          if (el) av.bindVideoElement(tile.tileId, el);
          if (!tile.localTile) setRemoteVideo(true);
          logClient(tile.localTile ? 'local_tile' : 'remote_tile', role, callId.current, `active=${tile.active}`);
        },
        videoTileWasRemoved: () => { setRemoteVideo(false); logClient('remote_tile_removed', role, callId.current); },
        audioVideoDidStop: status => {
          logClient('chime_stopped', role, callId.current, `status=${status.statusCode()}`);
          if (session.current) { void leave(); setPhase('ended'); }
        },
      });

      const mics = await av.listAudioInputDevices();
      if (mics[0]) { await av.startAudioInput(mics[0].deviceId); logClient('mic_started', role, callId.current); } else logClient('no_mic', role, callId.current);
      if (audioEl.current) await av.bindAudioElement(audioEl.current);
      av.start();
      logClient('session_started', role, callId.current);

      const cameras = await av.listVideoInputDevices();
      if (cameras[0]) {
        await av.startVideoInput(cameras[0].deviceId);
        av.startLocalVideoTile();
        setCameraOn(true);
        logClient('camera_started', role, callId.current);
      } else logClient('no_camera', role, callId.current);
      setPhase('live');
    } catch (e: unknown) {
      await leave();
      logClient('error', role, callId.current, e instanceof Error ? `${e.name}: ${e.message}` : 'unknown');
      setError(e instanceof Error ? e.message : 'Could not start the call');
      setPhase('idle');
    }
  };

  const toggleMute = (): void => {
    const av = session.current?.audioVideo;
    if (!av) return;
    if (muted) { av.realtimeUnmuteLocalAudio(); setMuted(false); logClient('unmute', role, callId.current); } else { av.realtimeMuteLocalAudio(); setMuted(true); logClient('mute', role, callId.current); }
  };

  const toggleCamera = (): void => {
    const av = session.current?.audioVideo;
    if (!av) return;
    if (cameraOn) { av.stopLocalVideoTile(); setCameraOn(false); logClient('camera_off', role, callId.current); } else { av.startLocalVideoTile(); setCameraOn(true); logClient('camera_on', role, callId.current); }
  };

  const endForEveryone = async (): Promise<void> => {
    if (!actor || !caseId || !call) return;
    logClient('end_for_everyone', role, call.id);
    try { await callsApi.end(caseId, call.id, actor); } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Could not end the call'); }
    await leave();
    setPhase('ended');
  };

  if (!snapshot || !actor) return null;
  const live = phase === 'live';
  return (
    <Panel title="Live video call (Amazon Chime)" className="call-controls-video">
      <div className="row wrap">
        <Badge tone={live ? 'success' : 'neutral'}>{live ? 'Live · real audio and video' : 'Not connected'}</Badge>
        <span>Joined as {actor.name} · {role}</span>
      </div>
      {error && <p role="alert" className="muted">{error}</p>}
      <audio ref={audioEl} autoPlay />
      <div className="video-grid">
        <div>
          <video ref={localEl} muted playsInline autoPlay style={{ ...videoStyle, display: live && cameraOn ? 'block' : 'none' }} />
          {!(live && cameraOn) && <div className="video-placeholder"><span>You{live ? ' · camera off' : ''}</span></div>}
        </div>
        <div>
          <video ref={remoteEl} playsInline autoPlay style={{ ...videoStyle, display: live && remoteVideo ? 'block' : 'none' }} />
          {!(live && remoteVideo) && <div className="video-placeholder"><span>{live ? 'Waiting for the other person…' : 'Other participant'}</span></div>}
        </div>
      </div>
      <div className="row wrap">
        {!live && <Button disabled={phase === 'starting'} onClick={() => { void start(); }}>{phase === 'starting' ? 'Connecting…' : phase === 'ended' ? 'Start a new live call' : 'Start or join live call'}</Button>}
        {live && <>
          <Button variant="outline" onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</Button>
          <Button variant="outline" onClick={toggleCamera}>{cameraOn ? 'Camera off' : 'Camera on'}</Button>
          <Button variant="outline" onClick={() => { logClient('leave', role, callId.current); void leave().then(() => setPhase('idle')); }}>Leave</Button>
          <Button variant="outline" onClick={() => { void endForEveryone(); }}>End for everyone</Button>
        </>}
      </div>
      <p className="muted call-media-note">Real Chime media. Nothing is recorded, captured or transcribed. Test with two tabs (founder and advisor) and headphones to avoid echo.</p>
    </Panel>
  );
}
