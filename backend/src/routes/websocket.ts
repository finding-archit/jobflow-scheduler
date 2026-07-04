import { FastifyInstance } from 'fastify';
import { redisSub, redisPub } from '../db/redis';

// Connected WebSocket clients per projectId
const clients = new Map<string, Set<any>>();

export function broadcast(projectId: string, event: string, data: any) {
  const room = clients.get(projectId);
  if (!room) return;
  const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  for (const socket of room) {
    try { socket.send(payload); } catch { /* client disconnected */ }
  }
}

export async function wsRoutes(app: FastifyInstance) {
  app.get('/events', { websocket: true }, (socket, request) => {
    const { projectId } = request.query as { projectId?: string };

    // socket is a SocketStream — the raw WebSocket is at socket.socket
    const ws = socket.socket;

    if (!projectId) {
      ws.send(JSON.stringify({ event: 'error', message: 'projectId required' }));
      ws.close();
      return;
    }

    if (!clients.has(projectId)) clients.set(projectId, new Set());
    clients.get(projectId)!.add(ws);

    ws.send(JSON.stringify({ event: 'connected', projectId, timestamp: new Date().toISOString() }));

    socket.on('close', () => {
      clients.get(projectId)?.delete(ws);
    });

    socket.on('message', (msg: Buffer) => {
      try {
        const { type } = JSON.parse(msg.toString());
        if (type === 'ping') ws.send(JSON.stringify({ event: 'pong' }));
      } catch { /* ignore */ }
    });
  });
}

// Subscribe to Redis pub/sub and forward to WebSocket clients
export async function startWsBridge() {
  try {
    await redisSub.subscribe('job-events');
    // IORedis fires 'message' events on the client, not in subscribe()
    redisSub.on('message', (_channel: string, message: string) => {
      try {
        const { projectId, event, data } = JSON.parse(message);
        broadcast(projectId, event, data);
      } catch { /* ignore malformed */ }
    });
  } catch {
    // Redis not available, skip WS bridge
  }
}

export async function publishEvent(projectId: string, event: string, data: any) {
  try {
    await redisPub.publish('job-events', JSON.stringify({ projectId, event, data }));
  } catch {
    // Fallback: broadcast directly
    broadcast(projectId, event, data);
  }
}
