/** Exercise portable art reviews in Chrome's remote debugging browser. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args.splice(index, 2)[1];
};
const port = option('--port', '9223');
const out = path.resolve(option('--out', '/tmp/interior-review-audit'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = text => createHash('sha256').update(text).digest('hex');

async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), errors = [], requests = [];
  let serial = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    if (message.id) {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(Error(JSON.stringify(message.error)));
      else item.resolve(message.result);
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  return { send, evaluate, errors, requests, close: () => socket.close() };
}

async function audit(folder) {
  const html = path.resolve(folder, 'review.html');
  assert(fs.existsSync(html), `Missing review: ${html}`);
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const page = await connect(target.webSocketDebuggerUrl);
  const { send, evaluate } = page;
  const name = path.basename(path.dirname(html));
  const biome = name === 'review' ? path.basename(path.dirname(path.dirname(html))) : name;
  try {
    for (const domain of ['Page', 'Runtime', 'Network']) await send(`${domain}.enable`);
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
    await send('Page.bringToFront');
    await send('Page.navigate', { url: pathToFileURL(html).href });
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      ready = await evaluate('Boolean(window.interiorReview?.ready)');
      if (!ready) await delay(100);
    }
    assert(ready, `${biome}: review did not load`);
    assert.equal(await evaluate('document.querySelectorAll("#decorations figure").length'), 8);
    assert.equal(await evaluate('document.querySelectorAll("#textures figure").length'), 4);
    assert.equal(await evaluate('document.querySelector("#error").textContent'), '');
    // Disable sprite animation while comparing scenery pixels.
    await evaluate('document.querySelector("#toggles label:last-child input").click()');
    const pixels = () => evaluate('document.querySelector("#scene").toDataURL()');
    const initial = hash(await pixels());
    await evaluate('travel.value=1370; travel.dispatchEvent(new Event("input"))');
    assert.notEqual(hash(await pixels()), initial, `${biome}: travel did not change the scene`);
    const moved = await evaluate('window.interiorReview.position');
    assert.equal(moved, 1370);
    for (let index = 0; index < 5; index++) {
      const before = hash(await pixels());
      await evaluate(`document.querySelectorAll('#toggles input')[${index}].click()`);
      assert.notEqual(hash(await pixels()), before, `${biome}: toggle ${index} did not change the scene`);
      await evaluate(`document.querySelectorAll('#toggles input')[${index}].click()`);
      assert.equal(hash(await pixels()), before, `${biome}: toggle ${index} did not restore the scene`);
    }
    await evaluate('document.querySelector("#play").click()');
    await delay(250);
    await evaluate('document.querySelector("#play").click()');
    assert((await evaluate('window.interiorReview.position')) > moved, `${biome}: travel playback did not advance`);
    await evaluate('travel.value=280; travel.dispatchEvent(new Event("input")); document.querySelector("#toggles label:last-child input").click()');
    for (const view of ['wide', 'tall', 'compact']) {
      await evaluate(`viewport.value=${JSON.stringify(view)}; viewport.dispatchEvent(new Event('change'))`);
      const geometry = await evaluate('({ width: canvas.width, height: canvas.height, ceiling: interiorReview.layout.ceilingY, ground: interiorReview.layout.groundY })');
      assert(geometry.ground > geometry.ceiling, `${biome}: invalid tunnel clearance`);
      assert.deepEqual([geometry.width, geometry.height], view === 'wide' ? [960, 440] : view === 'tall' ? [390, 720] : [640, 360]);
      const png = (await pixels()).split(',')[1];
      fs.writeFileSync(path.join(out, `${biome}-${view}.png`), Buffer.from(png, 'base64'));
    }
    await evaluate("viewport.value='wide'; viewport.dispatchEvent(new Event('change'))");
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(out, `${biome}-page.png`), Buffer.from(screenshot.data, 'base64'));
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `${biome}: mobile horizontal overflow`);
    assert.deepEqual(page.errors, [], `${biome}: browser exceptions`);
    assert.equal(page.requests.filter(url => /^https?:/.test(url)).length, 0, `${biome}: review requested an external asset`);
    return { biome, decorations: 8, viewports: 3, sceneryToggles: 5, offline: true, browserErrors: 0 };
  } finally {
    page.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
  }
}

async function main() {
  if (!args.length) throw Error('Usage: node scripts/check-interior-reviews.cjs [--port 9223] [--out /tmp/audit] REVIEW_FOLDER ...');
  fs.mkdirSync(out, { recursive: true });
  const results = [];
  for (const folder of args) results.push(await audit(folder));
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({ reviews: results, screenshots: out }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
