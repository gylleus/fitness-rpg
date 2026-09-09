import { createServer } from 'node:http';
import { open, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';

const apk = new URL('../android/app/build/outputs/apk/release/app-release.apk', import.meta.url);
const addresses = Object.values(networkInterfaces()).flat().filter(
  (entry) => entry && entry.family === 'IPv4' && !entry.internal,
);
const host = process.env.FITNESS_SHARE_HOST
  ?? addresses.find((entry) => entry.address.startsWith('192.168.'))?.address
  ?? addresses.find((entry) => entry.address.startsWith('10.'))?.address
  ?? '127.0.0.1';
const port = Number(process.env.FITNESS_SHARE_PORT ?? 8787);

function page(info) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fitness RPG · Android preview</title>
<style>
  body { background: #101923; color: #eef4f7; font: 18px/1.6 system-ui, sans-serif;
    max-width: 32rem; margin: 10vh auto; padding: 24px; }
  h1 { line-height: 1.2; } .label { color: #8be4ca; } small { color: #b9c8d1; }
  .download { display: block; margin: 28px 0; padding: 16px; border-radius: 12px;
    background: #8be4ca; color: #101923; font-weight: 700; text-align: center; text-decoration: none; }
</style></head><body>
<p class="label">ANDROID PREVIEW</p><h1>Fitness RPG</h1>
<p>Download the latest built version and open it to update your app.</p>
<small>Built ${info.mtime.toISOString().replace('T', ' ').slice(0, 19)} UTC · ${(info.size / 1024 / 1024).toFixed(1)} MB</small>
<a class="download" href="/fitness-rpg.apk" download>Download Android app</a>
<ol><li>Download and open the APK on your phone.</li>
<li>If Android asks, allow your browser to install this app.</li>
<li>Choose Update or Install, then open Fitness RPG.</li></ol>
<p>Install over your existing app to keep your workouts and hero. Do not uninstall it first.</p>
<small>Bookmark this page for future builds. Your phone must be on the same network,
and this computer and its download server must be running.</small>
</body></html>`;
}

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }
  const path = request.url?.split('?')[0];
  if (path !== '/' && path !== '/fitness-rpg.apk') {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  let file;
  try {
    if (path === '/') {
      const html = page(await stat(apk));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : html);
      return;
    }
    file = await open(apk, 'r');
    const info = await file.stat();
    response.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="fitness-rpg.apk"',
      'Content-Length': info.size,
    });
    if (request.method === 'HEAD') {
      await file.close();
      response.end();
      return;
    }
    const stream = file.createReadStream();
    stream.on('error', (error) => response.destroy(error));
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  } catch (error) {
    await file?.close().catch(() => {});
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Android preview is unavailable. Build it on the computer with npm run android:preview, then refresh.');
  }
});

server.on('error', (error) => {
  console.error(`Cannot start Android download server: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  console.log(`Fitness RPG download: http://${host}:${port}/`);
  console.log('Keep this process running. New release builds are served automatically. Ctrl+C stops sharing.');
  if (host === '127.0.0.1') console.log('Set FITNESS_SHARE_HOST to your LAN IPv4 address to connect from a phone.');
});
