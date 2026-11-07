import { API_BASE, renewSession } from './rest-client';
import type { ApiModels } from './types';

type Callback = (event: ApiModels.RealtimeEvent<Record<string, unknown>>) => void;

interface Subscriber {
  channels: Set<string>;
  callback: Callback;
}

const WS_BASE =
  process.env.NEXT_PUBLIC_WS_URL ||
  API_BASE.replace(/^http/, 'ws');

/**
 * The close code for "no session": a refused handshake, sessions ended by the
 * server, and — since the server closes a socket when the access token it was
 * opened with expires — every socket, once per token lifetime.
 */
const SESSION_CLOSED = 4401;
/**
 * How long a socket has to stay open to count as accepted. The server answers a
 * refused handshake by closing it a moment AFTER `open`, so `open` alone proves
 * nothing.
 */
const SETTLED_MS = 5_000;

let ws: WebSocket | null = null;
const subs: Set<Subscriber> = new Set();
let activeChannels: Set<string> = new Set();
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
/** Set once the first socket opens: every later open is a REconnect. */
let everOpened = false;
/**
 * Whether a session-closed socket has already been answered with a renewal since
 * the last socket that settled. Without it, an account the handshake refuses
 * whatever the cookie (a temporary password) would renew and reconnect forever.
 */
let renewedSinceSettled = false;
/** Set by closeRealtime (signing out): nothing reconnects until something subscribes again. */
let suspended = false;

function connect() {
  if (suspended) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  let socket: WebSocket;
  try {
    socket = new WebSocket(`${WS_BASE.replace(/\/$/, '')}/ws/collections/`);
  } catch {
    scheduleReconnect();
    return;
  }
  ws = socket;
  /** When this socket opened; 0 until it does. */
  let openedAt = 0;
  socket.addEventListener('open', () => {
    // Signed out while this one was still connecting.
    if (suspended) {
      socket.close();
      return;
    }
    openedAt = Date.now();
    if (activeChannels.size > 0) {
      socket.send(JSON.stringify({ action: 'subscribe', channels: [...activeChannels] }));
    }
    // Whatever happened while the socket was down — a restart, a deploy, a
    // proxy dropping it for up to 30s of backoff — was never sent, and no frame
    // will come for it: every open screen kept showing what it had. A reconnect
    // is the moment to ask again, so every subscriber refetches once.
    if (everOpened) {
      const frame = {
        event: 'realtime.reconnected',
        payload: {},
        timestamp: new Date().toISOString(),
      };
      for (const sub of subs) {
        sub.callback({ ...frame, channels: [...sub.channels] });
      }
    }
    everOpened = true;
  });
  socket.addEventListener('message', (e) => {
    let frame: ApiModels.RealtimeEvent<Record<string, unknown>> | null;
    try { frame = JSON.parse(e.data); } catch { return; }
    if (!frame || !Array.isArray(frame.channels)) return;
    for (const sub of subs) {
      for (const ch of frame.channels) {
        if (sub.channels.has(ch)) {
          sub.callback(frame);
          break;
        }
      }
    }
  });
  socket.addEventListener('close', (event) => {
    if (ws === socket) ws = null;
    // The backoff starts over only after a socket the server actually kept. It
    // used to reset on every `open`, and a refused handshake opens before it is
    // closed — so a refused socket was retried every second, indefinitely.
    if (openedAt && Date.now() - openedAt >= SETTLED_MS) {
      reconnectAttempts = 0;
      renewedSinceSettled = false;
    }
    if (suspended) return;
    // The server closes a socket when the access token it was opened with
    // expires. Renew the session — which an idle tab would otherwise not do until
    // somebody clicked something — and come straight back with the new cookie.
    if (event.code === SESSION_CLOSED && !renewedSinceSettled && subs.size > 0) {
      renewedSinceSettled = true;
      void renewSession().then((outcome) => {
        if (outcome === 'renewed' && subs.size > 0) connect();
        else scheduleReconnect();
      });
      return;
    }
    scheduleReconnect();
  });
  socket.addEventListener('error', () => {
    socket.close();
  });
}

function scheduleReconnect() {
  if (suspended || reconnectTimer || subs.size === 0) return;
  const delay = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempts, 5));
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function recomputeChannels() {
  const next = new Set<string>();
  for (const s of subs) for (const c of s.channels) next.add(c);
  const added = [...next].filter((c) => !activeChannels.has(c));
  const removed = [...activeChannels].filter((c) => !next.has(c));
  activeChannels = next;
  if (ws?.readyState === WebSocket.OPEN) {
    if (added.length) ws.send(JSON.stringify({ action: 'subscribe', channels: added }));
    if (removed.length) ws.send(JSON.stringify({ action: 'unsubscribe', channels: removed }));
  }
}

export function subscribeToChannels(channels: string[], callback: Callback): () => void {
  const sub: Subscriber = { channels: new Set(channels), callback };
  subs.add(sub);
  recomputeChannels();
  // Subscribing again is what ends a sign-out's suspension: it is the next
  // session's screen mounting.
  suspended = false;
  connect();
  return () => {
    subs.delete(sub);
    recomputeChannels();
    if (subs.size === 0 && ws) {
      const socket = ws;
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener(
          'open',
          () => {
            if (subs.size === 0 && socket.readyState === WebSocket.OPEN) {
              socket.close();
            }
          },
          { once: true }
        );
      } else {
        socket.close();
        ws = null;
      }
    }
  };
}

/**
 * Close the socket on signing out, and stay closed until something subscribes again.
 *
 * The screens holding subscriptions unmount a moment later anyway, but until they
 * do the socket would go on reconnecting with a session that no longer exists —
 * and a tab signed out from ANOTHER tab kept streaming until its own token ran out.
 */
export function closeRealtime(): void {
  suspended = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  // The next session starts with no backoff carried over from this one.
  reconnectAttempts = 0;
  renewedSinceSettled = false;
  // One still connecting closes itself on `open` (see connect), which avoids the
  // browser's "closed before the connection is established" warning.
  if (ws?.readyState === WebSocket.OPEN) {
    ws.close();
    ws = null;
  }
}
