import { API_BASE } from './rest-client';
import type { ApiModels } from './types';

type Callback = (event: ApiModels.RealtimeEvent) => void;

interface Subscriber {
  channels: Set<string>;
  callback: Callback;
}

const WS_BASE =
  process.env.NEXT_PUBLIC_WS_URL ||
  API_BASE.replace(/^http/, 'ws');

let ws: WebSocket | null = null;
const subs: Set<Subscriber> = new Set();
let activeChannels: Set<string> = new Set();
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(`${WS_BASE.replace(/\/$/, '')}/ws/collections/`);
  } catch {
    scheduleReconnect();
    return;
  }
  ws.addEventListener('open', () => {
    reconnectAttempts = 0;
    if (activeChannels.size > 0) {
      ws?.send(JSON.stringify({ action: 'subscribe', channels: [...activeChannels] }));
    }
  });
  ws.addEventListener('message', (e) => {
    let frame: any;
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
  ws.addEventListener('close', () => {
    ws = null;
    scheduleReconnect();
  });
  ws.addEventListener('error', () => {
    ws?.close();
  });
}

function scheduleReconnect() {
  if (reconnectTimer || subs.size === 0) return;
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
