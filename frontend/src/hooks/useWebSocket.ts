import { useEffect, useRef, useState } from 'react';

export type WsEvent = { event: string; data: any; timestamp: string };

export function useWebSocket(projectId: string | null) {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<WsEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const connect = () => {
    if (!projectId) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${window.location.host}/ws/events?projectId=${projectId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 3000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => {
      try { setLastEvent(JSON.parse(e.data)); } catch { /* ignore */ }
    };
  };

  useEffect(() => {
    connect();
    const ping = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    return () => {
      clearTimeout(reconnectTimer.current);
      clearInterval(ping);
      wsRef.current?.close();
    };
  }, [projectId]);

  return { connected, lastEvent };
}
