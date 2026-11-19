import { TestBed } from '@angular/core/testing';
import type { Subscription } from 'rxjs';
import type { ConnectionStatus, TrackFrame } from './track.model';
import { TRACK_SERVER_URL, WebSocketTrackStream, reconnectDelayMs } from './websocket-track-stream';

/** Just enough of the browser WebSocket for rxjs/webSocket, driven by the test. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  binaryType = 'blob';
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  static latest(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }

  send(): void {}

  close(): void {
    this.readyState = 3;
  }

  acceptConnection(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  sendFrame(frame: TrackFrame): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
  }

  drop(wasClean: boolean): void {
    this.readyState = 3;
    this.onclose?.({ wasClean, code: wasClean ? 1000 : 1006, reason: '' } as CloseEvent);
  }
}

const FRAME: TrackFrame = {
  t: 0,
  tracks: [],
  shuttle: { phase: 'approaching', arrivesInSeconds: 60, doorsOpen: false, spaceFor: 120 },
};

describe('reconnectDelayMs', () => {
  it('doubles from 500 ms and caps at 8 s', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(reconnectDelayMs)).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
  });
});

describe('WebSocketTrackStream', () => {
  let stream: WebSocketTrackStream;
  let statuses: ConnectionStatus[];
  let frames: TrackFrame[];
  let subscriptions: Subscription[];

  /** Lets the current socket close, then reports how long until the next socket was created. */
  function msUntilNextSocket(): number {
    const socketsBefore = FakeWebSocket.instances.length;
    let waited = 0;
    while (FakeWebSocket.instances.length === socketsBefore && waited < 60_000) {
      vi.advanceTimersByTime(100);
      waited += 100;
    }
    return waited;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    FakeWebSocket.instances = [];
    TestBed.configureTestingModule({
      providers: [{ provide: TRACK_SERVER_URL, useValue: 'ws://test:8787' }, WebSocketTrackStream],
    });
    stream = TestBed.inject(WebSocketTrackStream);
    statuses = [];
    frames = [];
    subscriptions = [
      stream.status$.subscribe((status) => statuses.push(status)),
      stream.frames$.subscribe((frame) => frames.push(frame)),
    ];
  });

  afterEach(() => {
    subscriptions.forEach((subscription) => subscription.unsubscribe());
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reports connecting, then live once the socket opens, and passes frames through', () => {
    expect(statuses).toEqual(['connecting']);
    expect(FakeWebSocket.latest().url).toBe('ws://test:8787');

    FakeWebSocket.latest().acceptConnection();
    FakeWebSocket.latest().sendFrame(FRAME);

    expect(statuses.at(-1)).toBe('live');
    expect(frames).toEqual([FRAME]);
  });

  it('reports reconnecting on a drop, clean or not', () => {
    FakeWebSocket.latest().acceptConnection();
    FakeWebSocket.latest().drop(true);
    expect(statuses.at(-1)).toBe('reconnecting');

    vi.advanceTimersByTime(500);
    FakeWebSocket.latest().acceptConnection();
    FakeWebSocket.latest().drop(false);
    expect(statuses).toEqual(['connecting', 'live', 'reconnecting', 'live', 'reconnecting']);
  });

  it('backs off exponentially, capped at 8 s, while connections drop without sending frames', () => {
    const waits: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      FakeWebSocket.latest().acceptConnection();
      FakeWebSocket.latest().drop(true);
      waits.push(msUntilNextSocket());
    }

    expect(waits).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
  });

  it('resets the backoff once frames flow again', () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      FakeWebSocket.latest().drop(false);
      msUntilNextSocket();
    }

    FakeWebSocket.latest().acceptConnection();
    FakeWebSocket.latest().sendFrame(FRAME);
    FakeWebSocket.latest().drop(false);

    expect(msUntilNextSocket()).toBe(500);
  });
});
