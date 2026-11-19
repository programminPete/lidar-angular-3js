/**
 * Optional WebSocket track server: runs the same simulator as the browser and
 * broadcasts one JSON TrackFrame to every client 10 times a second.
 *
 *   npm run server
 *   open http://localhost:4200/?ws=ws://localhost:8787
 */
import { WebSocketServer, WebSocket } from 'ws';
import { PlatformSimulator } from '../src/app/platform/data/simulation/platform-simulator';
import { FRAME_INTERVAL_MS } from '../src/app/platform/data/track.model';

const PORT = 8787;
const SIMULATION_SEED = 20261117;

const simulator = new PlatformSimulator(SIMULATION_SEED);
const server = new WebSocketServer({ port: PORT });

server.on('connection', (socket, request) => {
  console.log(`client connected from ${request.socket.remoteAddress} (${server.clients.size} open)`);
  socket.on('close', () => console.log(`client left (${server.clients.size} open)`));
});

setInterval(() => {
  const message = JSON.stringify(simulator.step(FRAME_INTERVAL_MS / 1000));
  for (const client of server.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}, FRAME_INTERVAL_MS);

console.log(`Track server broadcasting at 10 Hz on ws://localhost:${PORT}`);
