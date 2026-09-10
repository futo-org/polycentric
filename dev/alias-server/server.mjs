// Serves ./polycentric.json at /.well-known/polycentric.json so a tunnel can
// stand in for a real alias domain (e.g. ssh -R 80:localhost:3020 nokey@localhost.run)
// Copy polycentric.json.example to polycentric.json (gitignored), edit it,
// and it is re-read on every request.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const PORT = 3020;
const DOCUMENT_PATH = new URL('./polycentric.json', import.meta.url);

createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path !== '/.well-known/polycentric.json') {
    response.writeHead(404).end();
    return;
  }
  const body = await readFile(DOCUMENT_PATH).catch(() => '{"names":{}}');
  response
    .writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    })
    .end(body);
}).listen(PORT, () => console.log(`alias server on http://localhost:${PORT}`));
