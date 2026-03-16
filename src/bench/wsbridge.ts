import { WebSocketServer, WebSocket } from 'ws';
import type { BackendToWebviewMessage, WebviewToBackendMessage } from '../views/webview/types';

const DEFAULT_PORT = 9225;

export interface Bridge {
  broadcast(msg: BackendToWebviewMessage): void;
  onCommand: ((msg: WebviewToBackendMessage) => void) | null;
  stop(): void;
  port: number;
}

export function startBridge(port: number = DEFAULT_PORT): Bridge {
  const wss = new WebSocketServer({ port });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as WebviewToBackendMessage;
        bridge.onCommand?.(msg);
      } catch { /* ignore malformed */ }
    });
  });

  const bridge: Bridge = {
    broadcast(msg) {
      const json = JSON.stringify(msg);
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(json);
        }
      }
    },
    onCommand: null,
    stop() {
      for (const ws of clients) ws.close();
      clients.clear();
      wss.close();
    },
    port,
  };

  return bridge;
}
