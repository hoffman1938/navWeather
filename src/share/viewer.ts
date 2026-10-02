import { apiPaths } from '../api/v1';
import { create } from 'zustand';
import { matchForecastToTime } from '../algorithms/weatherMatching';
import { getProviders } from '../services/providers';
import type { LngLat } from '../types/geo';
import type { WeatherAtTime } from '../types/weather';
import { haversineM } from '../utils/distance';
import type { ServerMessage, ShareSnapshot } from './protocol';

/**
 * VIEWER side of live location: opens /live/:id, streams snapshots over a
 * WebSocket (reconnecting with backoff; HTTP polling when sockets fail) and
 * looks up the weather where the sharer is and at their destination on arrival.
 */

export interface ViewerWeather {
  here: { weather: WeatherAtTime; timezone: string } | null;
  destination: { weather: WeatherAtTime | null; arrivalMs: number; timezone: string } | null;
}

export interface ViewerState {
  id: string | null;
  status: 'connecting' | 'live' | 'reconnecting' | 'ended' | 'notfound';
  snapshot: ShareSnapshot | null;
  follow: boolean;
  weather: ViewerWeather;
  start(id: string): void;
  stop(): void;
  setFollow(follow: boolean): void;
}

let socket: WebSocket | null = null;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let watchdog: ReturnType<typeof setInterval> | null = null;
/** Each start() is a new session; late callbacks from an older one are ignored (StrictMode double-mount, restarts). */
let session = 0;
let lastMessageAt = 0;
let weatherFor: { here: LngLat | null; hereAt: number; dest: string | null } = { here: null, hereAt: 0, dest: null };

export const useViewer = create<ViewerState>()((set, get) => ({
  id: null,
  status: 'connecting',
  snapshot: null,
  follow: true,
  weather: { here: null, destination: null },

  start(id) {
    get().stop();
    const sid = ++session;
    set({ id, status: 'connecting', snapshot: null, follow: true, weather: { here: null, destination: null } });
    weatherFor = { here: null, hereAt: 0, dest: null };
    void firstLoad(id, sid);
    // A socket can die silently (phone backgrounded, network switch): the relay
    // answers our pings, so a long silence means reconnect.
    watchdog = setInterval(() => {
      if (sid !== session || !socket || socket.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastMessageAt > 60_000) socket.close();
    }, 15_000);
    document.addEventListener('visibilitychange', onVisible);
  },

  stop() {
    session++;
    closeAll();
    document.removeEventListener('visibilitychange', onVisible);
    set({ id: null });
  },

  setFollow: (follow) => set({ follow }),
}));

/** Back in the foreground: refresh at once and make sure a socket is open. */
function onVisible() {
  const { id, status } = useViewer.getState();
  if (document.visibilityState !== 'visible' || !id || status === 'ended' || status === 'notfound') return;
  const sid = session;
  void fetch(apiPaths.shareItem(id), { cache: 'no-store' })
    .then(async (res) => {
      if (sid !== session) return;
      if (res.status === 404) useViewer.setState({ status: useViewer.getState().snapshot ? 'ended' : 'notfound' });
      else if (res.ok) onSnapshot(id, sid, (await res.json()) as ShareSnapshot);
    })
    .catch(() => undefined);
  if (!socket || socket.readyState > WebSocket.OPEN) {
    if (retryTimer) clearTimeout(retryTimer);
    connect(id, sid);
  }
}

function closeAll() {
  if (retryTimer) clearTimeout(retryTimer);
  if (pollTimer) clearInterval(pollTimer);
  if (pingTimer) clearInterval(pingTimer);
  if (watchdog) clearInterval(watchdog);
  retryTimer = pollTimer = pingTimer = watchdog = null;
  const s = socket;
  socket = null;
  try {
    s?.close();
  } catch {
    /* already closed */
  }
}

async function firstLoad(id: string, sid: number) {
  // A plain GET first: tells "expired link" apart from "server unreachable".
  try {
    const res = await fetch(apiPaths.shareItem(id), { cache: 'no-store' });
    if (sid !== session) return;
    if (res.status === 404) {
      useViewer.setState({ status: 'notfound' });
      return;
    }
    if (res.ok && (res.headers.get('content-type') ?? '').includes('application/json')) onSnapshot(id, sid, (await res.json()) as ShareSnapshot);
  } catch {
    /* fall through to the socket, which retries */
  }
  connect(id, sid);
}

function connect(id: string, sid: number) {
  if (sid !== session) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let ws: WebSocket;
  try {
    ws = new WebSocket(`${proto}//${location.host}${apiPaths.shareSocket(id)}`);
  } catch {
    startPolling(id, sid);
    return;
  }
  socket = ws;
  ws.onopen = () => {
    retry = 0;
    lastMessageAt = Date.now();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 25_000);
  };
  ws.onmessage = (e) => {
    lastMessageAt = Date.now();
    if (typeof e.data !== 'string' || e.data === 'pong') return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(e.data) as ServerMessage;
    } catch {
      return;
    }
    if (msg.type === 'ended') {
      useViewer.setState({ status: 'ended' });
      closeAll();
    } else if (msg.type === 'snapshot') onSnapshot(id, sid, msg.snapshot);
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    const st = useViewer.getState();
    if (sid !== session || st.status === 'ended' || st.status === 'notfound') return;
    useViewer.setState({ status: 'reconnecting' });
    retry++;
    // After repeated socket failures (proxies), fall back to polling as well.
    if (retry >= 3) startPolling(id, sid);
    retryTimer = setTimeout(() => connect(id, sid), Math.min(15_000, 1000 * 2 ** Math.min(retry, 4)));
  };
}

function startPolling(id: string, sid: number) {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(apiPaths.shareItem(id), { cache: 'no-store' });
      if (sid !== session) return;
      if (res.status === 404) {
        useViewer.setState({ status: useViewer.getState().snapshot ? 'ended' : 'notfound' });
        closeAll();
        return;
      }
      if (res.ok) onSnapshot(id, sid, (await res.json()) as ShareSnapshot);
    } catch {
      /* keep trying */
    }
  }, 12_000);
}

function onSnapshot(id: string, sid: number, snapshot: ShareSnapshot) {
  if (sid !== session || useViewer.getState().id !== id) return;
  useViewer.setState({ snapshot, status: 'live' });
  void refreshWeather(snapshot);
}

/** Weather at the sharer's position (refreshed every 5 km / 15 min) and at the destination on arrival. */
async function refreshWeather(s: ShareSnapshot) {
  const svc = getProviders().weather;
  const now = Date.now();
  const tasks: Promise<void>[] = [];
  if (s.pos && (!weatherFor.here || haversineM(weatherFor.here, s.pos.c) > 5000 || now - weatherFor.hereAt > 15 * 60_000)) {
    const c = s.pos.c;
    weatherFor = { ...weatherFor, here: c, hereAt: now };
    tasks.push(
      svc.getForecasts([{ latitude: c[1], longitude: c[0] }], { needUntilMs: now + 3 * 3_600_000 }).then(({ forecasts }) => {
        const f = forecasts.get(svc.keyFor(c[1], c[0]));
        const w = f ? matchForecastToTime(f, Date.now()) : null;
        if (f && w) useViewer.setState((st) => ({ weather: { ...st.weather, here: { weather: w, timezone: f.timezone } } }));
      }),
    );
  }
  const trip = s.trip;
  const destKey = trip ? `${trip.dest.c.join(',')}|${Math.round((trip.eta ?? 0) / 600_000)}` : null;
  if (destKey !== weatherFor.dest) {
    weatherFor = { ...weatherFor, dest: destKey };
    if (!trip) useViewer.setState((st) => ({ weather: { ...st.weather, destination: null } }));
    else {
      const [lon, lat] = trip.dest.c;
      const arrivalMs = trip.eta ?? now;
      tasks.push(
        svc.getForecasts([{ latitude: lat, longitude: lon }], { needUntilMs: arrivalMs + 3_600_000 }).then(({ forecasts }) => {
          const f = forecasts.get(svc.keyFor(lat, lon));
          if (!f) return;
          useViewer.setState((st) => ({
            weather: { ...st.weather, destination: { weather: matchForecastToTime(f, arrivalMs), arrivalMs, timezone: f.timezone } },
          }));
        }),
      );
    }
  }
  await Promise.allSettled(tasks);
}
