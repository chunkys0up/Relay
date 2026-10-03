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
  return { CallsApiError: original.CallsApiError, callsApi: { create: vi.fn(), join: vi.fn(), end: vi.fn() } };
});
vi.mock('./context', () => ({ useRelay: vi.fn() }));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let observer: AudioVideoObserver;
const actor = { id: 'founder-1', name: 'Alex Morgan', role: 'founder' as const };
const other = { id: 'advisor-1', name: 'Jordan Lee', role: 'advisor' as const };

async function begin(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Start or join live call' }));
  await waitFor(() => expect(av.start).toHaveBeenCalledOnce());
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
  vi.mocked(callsApi.end).mockResolvedValue({
    id: 'call-1', case_id: 'case-1', state: 'ended', participants: [], capture: 'off',
  });
  av.addObserver.mockImplementation((value: AudioVideoObserver) => { observer = value; });
  av.listAudioInputDevices.mockResolvedValue([{ deviceId: 'microphone-1' }]);
  av.startAudioInput.mockResolvedValue(undefined);
  av.stopAudioInput.mockResolvedValue(undefined);
  av.bindAudioElement.mockResolvedValue(undefined);
  av.listVideoInputDevices.mockResolvedValue([{ deviceId: 'camera-1' }]);
  av.startVideoInput.mockResolvedValue(undefined);
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
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [] });
    const previousDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    try {
      const labelTrigger = devices.setDeviceLabelTrigger.mock.calls[0][0] as () => Promise<MediaStream>;
      await labelTrigger();
      expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    } finally {
      if (previousDevices) Object.defineProperty(navigator, 'mediaDevices', previousDevices);
      else Reflect.deleteProperty(navigator, 'mediaDevices');
    }
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
    const signal = vi.mocked(callsApi.create).mock.calls[0][2];
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
    await act(async () => pending.resolve({
      call: { id: 'call-1', case_id: 'case-1', state: 'connecting', participants: [], capture: 'off' },
      meeting: {}, attendee: {},
    }));
    expect(av.addObserver).not.toHaveBeenCalled();
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
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
    expect(av.startVideoInput).toHaveBeenCalledWith('camera-1');
    fireEvent.click(screen.getByRole('button', { name: 'Turn camera off' }));
    await waitFor(() => expect(av.stopVideoInput).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(av.stop).toHaveBeenCalledOnce());
    expect(av.removeObserver).toHaveBeenCalledWith(observer);
    expect(callsApi.end).not.toHaveBeenCalled();
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByText(/Others may still be connected/)).toBeInTheDocument();
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
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
    expect(av.start).not.toHaveBeenCalled();
  });

  it('keeps the microphone unavailable after permission denial and tears down on SDK stop', async () => {
    av.startAudioInput.mockRejectedValueOnce(new Error('device path'));
    const onActiveChange = vi.fn();
    render(<LiveCall onActiveChange={onActiveChange} />);
    await begin();
    expect(screen.getByText(/Microphone access was denied or unavailable/)).toBeInTheDocument();
    act(() => observer.audioVideoDidStart?.());
    expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeDisabled();
    act(() => observer.audioVideoDidStop?.({} as Parameters<NonNullable<AudioVideoObserver['audioVideoDidStop']>>[0]));
    await waitFor(() => expect(av.stop).toHaveBeenCalledOnce());
    expect(screen.getByText('The live connection ended.')).toBeInTheDocument();
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });
});
