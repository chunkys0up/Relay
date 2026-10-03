import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioVideoObserver } from 'amazon-chime-sdk-js';
import { callsApi, CallsApiError } from './callsApi';
import { useRelay } from './context';
import { LiveCall } from './liveCall';

const av = vi.hoisted(() => ({
  addObserver: vi.fn(),
  removeObserver: vi.fn(),
  listAudioInputDevices: vi.fn(),
  startAudioInput: vi.fn(),
  stopAudioInput: vi.fn(),
  bindAudioElement: vi.fn(),
  unbindAudioElement: vi.fn(),
  listVideoInputDevices: vi.fn(),
  startVideoInput: vi.fn(),
  stopVideoInput: vi.fn(),
  startLocalVideoTile: vi.fn(),
  stopLocalVideoTile: vi.fn(),
  bindVideoElement: vi.fn(),
  realtimeMuteLocalAudio: vi.fn(),
  realtimeUnmuteLocalAudio: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));
const devices = vi.hoisted(() => ({ setDeviceLabelTrigger: vi.fn() }));

vi.mock('amazon-chime-sdk-js', () => ({
  NoOpLogger: class {},
  MeetingSessionConfiguration: class {},
  DefaultDeviceController: class { setDeviceLabelTrigger = devices.setDeviceLabelTrigger; },
  DefaultMeetingSession: class { audioVideo = av; },
}));
vi.mock('./callsApi', async importOriginal => {
  const original = await importOriginal<typeof import('./callsApi')>();
  return { CallsApiError: original.CallsApiError, callsApi: { create: vi.fn(), join: vi.fn(), leave: vi.fn(), end: vi.fn() } };
});
vi.mock('./context', () => ({ useRelay: vi.fn() }));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let observer: AudioVideoObserver;
let cameraStream: MediaStream;
let cameraTrack: { readyState: string; stop: ReturnType<typeof vi.fn> };
const actor = { id: 'founder-1', name: 'Alex Morgan', role: 'founder' as const };
const other = { id: 'advisor-1', name: 'Jordan Lee', role: 'advisor' as const };

async function begin(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Start or join live call' }));
  await waitFor(() => expect(av.start).toHaveBeenCalledOnce());
}

function captureDeviceTimeouts(delayMs = 5000): { fire: () => void; restore: () => void } {
  const callbacks: Array<() => void> = [];
  const original = window.setTimeout.bind(window);
  const spy = vi.spyOn(window, 'setTimeout').mockImplementation((handler, delay) => {
    if (delay === delayMs && typeof handler === 'function') {
      callbacks.push(handler);
      return 9999 as unknown as ReturnType<typeof setTimeout>;
    }
    return original(handler, delay) as unknown as ReturnType<typeof setTimeout>;
  });
  return { fire: () => { const callback = callbacks.pop(); expect(callback).toBeDefined(); callback?.(); },
    restore: () => spy.mockRestore() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useRelay).mockReturnValue({
    snapshot: { id: 'case-1', company: 'Northstar', founder: actor, advisors: [other] },
    role: 'founder',
  } as ReturnType<typeof useRelay>);
  vi.mocked(callsApi.create).mockResolvedValue({
    id: 'call-1', case_id: 'case-1', state: 'ringing', participants: [], capture: 'off',
  });
  vi.mocked(callsApi.join).mockResolvedValue({
    call: { id: 'call-1', case_id: 'case-1', state: 'connecting', participants: [], capture: 'off' },
    meeting: {}, attendee: {},
  });
  vi.mocked(callsApi.leave).mockResolvedValue({
    id: 'call-1', case_id: 'case-1', state: 'ringing', participants: [], capture: 'off',
  });
  vi.mocked(callsApi.end).mockResolvedValue({
    id: 'call-1', case_id: 'case-1', state: 'ended', participants: [], capture: 'off',
  });
  av.addObserver.mockImplementation((value: AudioVideoObserver) => { observer = value; });
  av.listAudioInputDevices.mockResolvedValue([{ deviceId: 'microphone-1' }]);
  av.startAudioInput.mockResolvedValue(undefined);
  av.stopAudioInput.mockResolvedValue(undefined);
  av.bindAudioElement.mockResolvedValue(undefined);
  cameraTrack = { readyState: 'live', stop: vi.fn() };
  cameraStream = { getTracks: () => [cameraTrack], getVideoTracks: () => [cameraTrack] } as unknown as MediaStream;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(cameraStream) },
  });
  av.startVideoInput.mockImplementation(async () => cameraStream);
  av.startLocalVideoTile.mockReturnValue(7);
  av.stopVideoInput.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('LiveCall', () => {
  it('requires the SDK start event before saying connected and keeps camera off on join', async () => {
    const onActiveChange = vi.fn();
    render(<LiveCall onActiveChange={onActiveChange} />);
    expect(screen.getByText('Ready to call?')).toBeInTheDocument();
    await begin();
    expect(screen.getByText('Connecting')).toBeInTheDocument();
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
    expect(av.startVideoInput).not.toHaveBeenCalled();
    expect(av.startLocalVideoTile).not.toHaveBeenCalled();
    const labelTrigger = devices.setDeviceLabelTrigger.mock.calls[0][0] as () => Promise<MediaStream>;
    await expect(labelTrigger()).rejects.toThrow('Device labels unavailable');
    act(() => observer.audioVideoDidStart?.());
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn camera on' })).toBeEnabled();
  });

  it('aborts a pending create and ignores its late result', async () => {
    const pending = deferred<Awaited<ReturnType<typeof callsApi.create>>>();
    vi.mocked(callsApi.create).mockReturnValueOnce(pending.promise);
    const onActiveChange = vi.fn();
    render(<LiveCall onActiveChange={onActiveChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start or join live call' }));
    await waitFor(() => expect(callsApi.create).toHaveBeenCalledOnce());
    const signal = vi.mocked(callsApi.create).mock.calls[0][1];
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve({ id: 'late', case_id: 'case-1', state: 'ringing', participants: [], capture: 'off' }));
    expect(callsApi.join).not.toHaveBeenCalled();
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it('aborts a pending join on unmount and ignores its late config', async () => {
    const pending = deferred<Awaited<ReturnType<typeof callsApi.join>>>();
    vi.mocked(callsApi.join).mockReturnValueOnce(pending.promise);
    const onActiveChange = vi.fn();
    const view = render(<LiveCall onActiveChange={onActiveChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start or join live call' }));
    await waitFor(() => expect(callsApi.join).toHaveBeenCalledOnce());
    const signal = vi.mocked(callsApi.join).mock.calls[0][3];
    view.unmount();
    expect(signal?.aborted).toBe(true);
    expect(callsApi.leave).toHaveBeenCalledWith('case-1', 'call-1', expect.any(String));
    await act(async () => pending.resolve({
      call: { id: 'call-1', case_id: 'case-1', state: 'connecting', participants: [], capture: 'off' },
      meeting: {}, attendee: {},
    }));
    expect(av.addObserver).not.toHaveBeenCalled();
    await waitFor(() => expect(onActiveChange).toHaveBeenLastCalledWith(false));
  });

  it('releases a microphone acquired after cancellation', async () => {
    const pending = deferred<void>();
    av.startAudioInput.mockReturnValueOnce(pending.promise);
    render(<LiveCall />);
    fireEvent.click(screen.getByRole('button', { name: 'Start or join live call' }));
    await waitFor(() => expect(av.startAudioInput).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => pending.resolve());
    await waitFor(() => expect(av.stopAudioInput).toHaveBeenCalledTimes(2));
    expect(av.start).not.toHaveBeenCalled();
    expect(av.removeObserver).toHaveBeenCalledWith(observer);
  });

  it('starts listen-only when microphone discovery stalls', async () => {
    const pending = deferred<MediaDeviceInfo[]>();
    av.listAudioInputDevices.mockReturnValueOnce(pending.promise);
    const timeout = captureDeviceTimeouts();
    try {
      render(<LiveCall />);
      fireEvent.click(screen.getByRole('button', { name: 'Start or join live call' }));
      await waitFor(() => expect(av.listAudioInputDevices).toHaveBeenCalledOnce());
      act(() => timeout.fire());
      await waitFor(() => expect(av.start).toHaveBeenCalledOnce());
      expect(av.startAudioInput).not.toHaveBeenCalled();
      expect(screen.getByText(/Microphone access is pending or unavailable/)).toBeInTheDocument();
      act(() => observer.audioVideoDidStart?.());
      expect(screen.getByText('Connected')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeDisabled();
      await act(async () => pending.resolve([{ deviceId: 'late-mic' } as MediaDeviceInfo]));
      expect(av.startAudioInput).not.toHaveBeenCalled();
    } finally { timeout.restore(); }
  });

  it('stops a microphone acquired after listen-only timeout', async () => {
    const pending = deferred<MediaStream | undefined>();
    av.startAudioInput.mockReturnValueOnce(pending.promise);
    const timeout = captureDeviceTimeouts();
    try {
      render(<LiveCall />);
      fireEvent.click(screen.getByRole('button', { name: 'Start or join live call' }));
      await waitFor(() => expect(av.startAudioInput).toHaveBeenCalledOnce());
      act(() => timeout.fire());
      await waitFor(() => expect(av.start).toHaveBeenCalledOnce());
      expect(av.realtimeMuteLocalAudio).toHaveBeenCalledOnce();
      act(() => observer.audioVideoDidStart?.());
      await act(async () => pending.resolve(undefined));
      await waitFor(() => expect(av.stopAudioInput).toHaveBeenCalledOnce());
      expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeDisabled();
    } finally { timeout.restore(); }
  });

  it('starts audio shutdown even if video shutdown is still pending', async () => {
    const pendingVideoStop = deferred<void>();
    av.stopVideoInput.mockReturnValueOnce(pendingVideoStop.promise);
    render(<LiveCall />);
    await begin();
    act(() => observer.audioVideoDidStart?.());
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(av.stopAudioInput).toHaveBeenCalledOnce());
    expect(av.stopVideoInput).toHaveBeenCalledOnce();
    await act(async () => pendingVideoStop.resolve());
  });

  it('starts camera only by action, stops its input when off, and cleans up on leave', async () => {
    const onActiveChange = vi.fn();
    render(<LiveCall onActiveChange={onActiveChange} />);
    await begin();
    act(() => observer.audioVideoDidStart?.());
    fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }));
    await waitFor(() => expect(av.startLocalVideoTile).toHaveBeenCalledOnce());
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(av.startVideoInput).toHaveBeenCalledWith(cameraStream);
    expect(screen.getByText(/Camera on/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn camera off' }));
    await waitFor(() => expect(av.stopVideoInput).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(av.stop).toHaveBeenCalledOnce());
    expect(av.removeObserver).toHaveBeenCalledWith(observer);
    expect(callsApi.end).not.toHaveBeenCalled();
    expect(callsApi.leave).toHaveBeenCalledOnce();
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByText(/Others may still be connected/)).toBeInTheDocument();
  });

  it('stops captured tracks even if stopping the local tile throws', async () => {
    render(<LiveCall />);
    await begin();
    act(() => observer.audioVideoDidStart?.());
    fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }));
    await waitFor(() => expect(screen.getByText(/Camera on ·/)).toBeInTheDocument());
    av.stopLocalVideoTile.mockImplementationOnce(() => { throw new Error('tile failure'); });
    fireEvent.click(screen.getByRole('button', { name: 'Turn camera off' }));
    expect(cameraTrack.stop).toHaveBeenCalledOnce();
    await waitFor(() => expect(av.stopVideoInput).toHaveBeenCalledOnce());
    expect(screen.getByText(/Camera off ·/)).toBeInTheDocument();
  });

  it('does not claim camera on when Chime returns no live video input', async () => {
    av.startVideoInput.mockResolvedValueOnce(undefined);
    render(<LiveCall />);
    await begin();
    act(() => observer.audioVideoDidStart?.());
    fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('did not provide a live video track'));
    expect(screen.getByText(/Camera off/)).toBeInTheDocument();
    expect(av.startLocalVideoTile).not.toHaveBeenCalled();
    expect(cameraTrack.stop).toHaveBeenCalledOnce();
  });

  it('releases a camera stream granted after permission timeout', async () => {
    const pending = deferred<MediaStream>();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValueOnce(pending.promise);
    render(<LiveCall />);
    await begin();
    act(() => observer.audioVideoDidStart?.());
    const timeout = captureDeviceTimeouts(30000);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }));
      await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce());
      expect(screen.getByText(/Waiting for the browser or system to open your camera/)).toBeInTheDocument();
      act(() => timeout.fire());
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Camera request is still waiting'));
      expect(av.startVideoInput).not.toHaveBeenCalled();
      await act(async () => pending.resolve(cameraStream));
      expect(cameraTrack.stop).toHaveBeenCalledOnce();
      expect(screen.getByText(/Camera off/)).toBeInTheDocument();
    } finally { timeout.restore(); }
  });

  it('leaves promptly while camera permission is pending and stops a late stream', async () => {
    const pending = deferred<MediaStream>();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValueOnce(pending.promise);
    render(<LiveCall />);
    await begin();
    act(() => observer.audioVideoDidStart?.());
    fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }));
    expect(screen.getByText(/Waiting for the browser or system to open your camera/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(callsApi.leave).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Waiting for the browser or system to open your camera/)).not.toBeInTheDocument();
    await act(async () => pending.resolve(cameraStream));
    expect(cameraTrack.stop).toHaveBeenCalledOnce();
    expect(av.startVideoInput).not.toHaveBeenCalled();
  });

  it('releases an opened camera immediately on leave while Chime startup is pending', async () => {
    const pending = deferred<MediaStream | undefined>();
    av.startVideoInput.mockReturnValueOnce(pending.promise);
    render(<LiveCall />);
    await begin();
    act(() => observer.audioVideoDidStart?.());
    fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }));
    await waitFor(() => expect(av.startVideoInput).toHaveBeenCalledOnce());
    expect(screen.getByText(/Starting video in Chime/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(cameraTrack.stop).toHaveBeenCalledOnce();
    expect(callsApi.leave).toHaveBeenCalledOnce();
    await act(async () => pending.resolve(cameraStream));
    expect(screen.queryByText(/Camera on ·/)).not.toBeInTheDocument();
  });

  it('does not stop a newer camera when an older Chime start finishes after leave', async () => {
    const oldStart = deferred<MediaStream | undefined>();
    const nextTrack = { readyState: 'live', stop: vi.fn() };
    const nextStream = { getTracks: () => [nextTrack], getVideoTracks: () => [nextTrack] } as unknown as MediaStream;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValueOnce(cameraStream).mockResolvedValueOnce(nextStream);
    av.startVideoInput.mockReturnValueOnce(oldStart.promise).mockResolvedValueOnce(nextStream);
    render(<LiveCall />);
    await begin();
    act(() => observer.audioVideoDidStart?.());
    fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }));
    await waitFor(() => expect(av.startVideoInput).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(cameraTrack.stop).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Start or rejoin live call' }));
    await waitFor(() => expect(av.start).toHaveBeenCalledTimes(2));
    act(() => observer.audioVideoDidStart?.());
    fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }));
    await waitFor(() => expect(av.startVideoInput).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/Camera on ·/)).toBeInTheDocument());
    await act(async () => oldStart.resolve(cameraStream));
    expect(nextTrack.stop).not.toHaveBeenCalled();
    expect(screen.getByText(/Camera on ·/)).toBeInTheDocument();
  });

  it('distinguishes stalled Chime startup and blocks another attempt until leave', async () => {
    const pending = deferred<MediaStream | undefined>();
    av.startVideoInput.mockReturnValueOnce(pending.promise);
    render(<LiveCall />);
    await begin();
    act(() => observer.audioVideoDidStart?.());
    const timeout = captureDeviceTimeouts();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }));
      await waitFor(() => expect(av.startVideoInput).toHaveBeenCalledOnce());
      act(() => timeout.fire());
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Chime did not start video'));
      expect(screen.getByRole('button', { name: 'Turn camera on' })).toBeDisabled();
      expect(cameraTrack.stop).toHaveBeenCalledOnce();
      await act(async () => pending.resolve(cameraStream));
      await waitFor(() => expect(av.stopVideoInput).toHaveBeenCalledOnce());
      expect(screen.getByRole('button', { name: 'Turn camera on' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
      expect(callsApi.leave).toHaveBeenCalledOnce();
    } finally { timeout.restore(); }
  });

  it('does not remain busy if Chime cleanup stalls', async () => {
    const pendingStop = deferred<void>();
    av.startVideoInput.mockRejectedValueOnce(new Error('startup failure'));
    av.stopVideoInput.mockReturnValueOnce(pendingStop.promise);
    render(<LiveCall />);
    await begin();
    act(() => observer.audioVideoDidStart?.());
    const timeout = captureDeviceTimeouts();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }));
      await waitFor(() => expect(av.stopVideoInput).toHaveBeenCalledOnce());
      act(() => timeout.fire());
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Camera cleanup is still waiting'));
      expect(screen.getByRole('button', { name: 'Turn camera on' })).toBeDisabled();
      expect(screen.queryByText(/Starting video in Chime/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
      expect(callsApi.leave).toHaveBeenCalledOnce();
      await act(async () => pendingStop.resolve());
    } finally { timeout.restore(); }
  });

  it('does not apply a stale cleanup error after leave and rejoin', async () => {
    const pendingStop = deferred<void>();
    av.startVideoInput.mockRejectedValueOnce(new Error('startup failure'));
    av.stopVideoInput.mockReturnValueOnce(pendingStop.promise);
    render(<LiveCall />);
    await begin();
    act(() => observer.audioVideoDidStart?.());
    fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }));
    await waitFor(() => expect(av.stopVideoInput).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start or rejoin live call' }));
    await waitFor(() => expect(av.start).toHaveBeenCalledTimes(2));
    act(() => observer.audioVideoDidStart?.());
    await act(async () => pendingStop.resolve());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn camera on' })).toBeEnabled();
  });

  it.each([
    ['NotAllowedError', 'Camera access was denied'],
    ['NotFoundError', 'No usable camera was found'],
    ['NotReadableError', 'The camera could not be opened'],
  ])('shows a safe %s camera error', async (name, message) => {
    const failure = Object.assign(new Error('private device path'), { name });
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(failure);
    render(<LiveCall />);
    await begin();
    act(() => observer.audioVideoDidStart?.());
    fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
    expect(screen.queryByText('private device path')).not.toBeInTheDocument();
    expect(av.startVideoInput).not.toHaveBeenCalled();
  });

  it('keeps hidden video elements measurable for Chime tiles', async () => {
    render(<LiveCall />);
    await begin();
    const videos = document.querySelectorAll('.relay-call-media video');
    expect(videos).toHaveLength(2);
    for (const video of videos) {
      expect(video).toHaveStyle({ visibility: 'hidden' });
      expect(video).not.toHaveStyle({ display: 'none' });
      expect(video.parentElement).toHaveClass('relay-call-media');
    }
  });

  it('rebinds local and remote video when their elements become visible', async () => {
    av.startLocalVideoTile.mockReturnValueOnce(7);
    render(<LiveCall />);
    await begin();
    act(() => observer.audioVideoDidStart?.());
    fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }));
    await waitFor(() => expect(av.bindVideoElement).toHaveBeenCalledWith(7, expect.any(HTMLVideoElement)));
    act(() => observer.videoTileDidUpdate?.({ tileId: 8, localTile: false, isContent: false, active: true } as Parameters<NonNullable<AudioVideoObserver['videoTileDidUpdate']>>[0]));
    await waitFor(() => expect(av.bindVideoElement).toHaveBeenCalledWith(8, expect.any(HTMLVideoElement)));
  });

  it('keeps local media connected when ending for everyone fails', async () => {
    vi.mocked(callsApi.end).mockRejectedValueOnce(new Error('private server detail'));
    render(<LiveCall />);
    await begin();
    act(() => observer.audioVideoDidStart?.());
    fireEvent.click(screen.getByRole('button', { name: 'End for everyone' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not confirm the call ended'));
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(av.stop).not.toHaveBeenCalled();
    expect(screen.queryByText('private server detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End for everyone' }));
    await waitFor(() => expect(screen.getByText('The call ended for everyone.')).toBeInTheDocument());
    expect(av.stop).toHaveBeenCalledOnce();
    expect(callsApi.leave).not.toHaveBeenCalled();
  });

  it('allows local leave while an end request is pending and ignores its late result', async () => {
    const pending = deferred<Awaited<ReturnType<typeof callsApi.end>>>();
    vi.mocked(callsApi.end).mockReturnValueOnce(pending.promise);
    render(<LiveCall />);
    await begin();
    act(() => observer.audioVideoDidStart?.());
    fireEvent.click(screen.getByRole('button', { name: 'End for everyone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(screen.getByText(/request to end for everyone may still complete/)).toBeInTheDocument();
    expect(callsApi.leave).toHaveBeenCalledOnce();
    await act(async () => pending.resolve({ id: 'call-1', case_id: 'case-1', state: 'ended', participants: [], capture: 'off' }));
    expect(screen.queryByText('The call ended for everyone.')).not.toBeInTheDocument();
  });

  it('shows a backend failure without exposing SDK or service details', async () => {
    vi.mocked(callsApi.create).mockRejectedValueOnce(new CallsApiError(502, 'private AWS detail'));
    const onActiveChange = vi.fn();
    render(<LiveCall onActiveChange={onActiveChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start or join live call' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('call service is unavailable'));
    expect(screen.queryByText('private AWS detail')).not.toBeInTheDocument();
    await waitFor(() => expect(onActiveChange).toHaveBeenLastCalledWith(false));
    expect(av.start).not.toHaveBeenCalled();
  });

  it('keeps the microphone unavailable after permission denial and tears down on SDK stop', async () => {
    av.startAudioInput.mockRejectedValueOnce(new Error('device path'));
    const onActiveChange = vi.fn();
    render(<LiveCall onActiveChange={onActiveChange} />);
    await begin();
    expect(screen.getByText(/Microphone access is pending or unavailable/)).toBeInTheDocument();
    act(() => observer.audioVideoDidStart?.());
    expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeDisabled();
    act(() => observer.audioVideoDidStop?.({} as Parameters<NonNullable<AudioVideoObserver['audioVideoDidStop']>>[0]));
    await waitFor(() => expect(av.stop).toHaveBeenCalledOnce());
    expect(screen.getByText('The live connection ended.')).toBeInTheDocument();
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
    expect(callsApi.leave).toHaveBeenCalledOnce();
  });

  it('rejoins with a fresh attendee after leaving this device', async () => {
    render(<LiveCall />);
    await begin();
    act(() => observer.audioVideoDidStart?.());
    const firstJoin = vi.mocked(callsApi.join).mock.calls[0][2];
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(callsApi.leave).toHaveBeenCalledWith('case-1', 'call-1', firstJoin);
    fireEvent.click(screen.getByRole('button', { name: 'Start or rejoin live call' }));
    await waitFor(() => expect(callsApi.join).toHaveBeenCalledTimes(2));
    expect(vi.mocked(callsApi.join).mock.calls[1][2]).not.toBe(firstJoin);
  });
});
