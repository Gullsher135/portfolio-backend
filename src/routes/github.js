import { Router } from 'express';
import { Image, Project, state } from '../models.js';
import { projectSchema } from '../schemas.js';
import { magic, uniqueId } from '../projectUtils.js';
import { buildDraft } from '../importer.js';

const API = () => (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function gh(path) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new HttpError(503, 'GitHub is not connected yet. Add GITHUB_TOKEN on Render (see Settings for the steps).');
  let res;
  try {
    res = await fetch(`${API()}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'gulsher-portfolio' },
      signal: AbortSignal.timeout(15000),
    });
  } catch { throw new HttpError(502, 'Could not reach GitHub. Try again in a moment.'); }
  if (res.status === 401) throw new HttpError(502, 'GitHub rejected the token. It may have expired or been revoked. Create a new one and update GITHUB_TOKEN.');
  if (res.status === 403 || res.status === 429) throw new HttpError(502, 'GitHub is limiting requests right now. Wait a few minutes and try again.');
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, `GitHub answered with an error (${res.status}).`);
  return res.json();
}

const b64 = (o) => (o?.content ? Buffer.from(o.content, o.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8') : '');
const safeJson = (t) => { try { return JSON.parse(t); } catch { return null; } };

// ---------- screenshot of a live website (uses a screenshot service, so no browser is needed on the server) ----------
export async function captureScreenshot(url) {
  if (!/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(url)) throw new HttpError(400, 'Enter the full public website address, for example https://yourproject.vercel.app');
  if (/^https?:\/\/(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0)/i.test(url)) throw new HttpError(400, 'That address is private. Use the public website link.');
  const base = (process.env.SCREENSHOT_API || 'https://api.microlink.io').replace(/\/$/, '');
  const q = new URLSearchParams({ url, screenshot: 'true', meta: 'false', type: 'jpeg', 'viewport.width': '1366', 'viewport.height': '768', waitForTimeout: '2500' });
  let json;
  try {
    const r = await fetch(`${base}/?${q}`, { signal: AbortSignal.timeout(45000) });
    json = await r.json();
  } catch { throw new HttpError(502, 'The screenshot service did not answer. Try again, or upload a screenshot yourself.'); }
  const imgUrl = json?.data?.screenshot?.url;
  if (json?.status !== 'success' || !imgUrl) throw new HttpError(502, 'The screenshot service could not open that website. Check the link, or upload a screenshot yourself.');
  const sameOrigin = new URL(imgUrl).origin === new URL(base).origin;
  if (!imgUrl.startsWith('https://') && !sameOrigin) throw new HttpError(502, 'The screenshot service returned an unsafe address.');
  let buf;
  let mime;
  try {
    const ir = await fetch(imgUrl, { signal: AbortSignal.timeout(25000) });
    if (!ir.ok) throw new Error('bad');
    mime = (ir.headers.get('content-type') || '').split(';')[0];
    buf = Buffer.from(await ir.arrayBuffer());
  } catch { throw new HttpError(502, 'Could not download the screenshot. Try again.'); }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) || buf.length > 3 * 1024 * 1024 || !magic(buf, mime)) throw new HttpError(502, 'The screenshot came back in an unexpected format.');
  const img = await Image.create({ data: buf, mime, size: buf.length, name: 'live-site-screenshot' });
  return `/api/images/${img.id}`;
}

export default function githubRoutes() {
  const r = Router();
  const needDb = (_req, res, next) => (state.dbReady ? next() : res.status(503).json({ message: 'The database is not connected.' }));

  r.get('/status', wrap(async (_req, res) => {
    if (!process.env.GITHUB_TOKEN) return res.json({ configured: false });
    const me = await gh('/user');
    res.json({ configured: true, user: me?.login || null });
  }));

  r.get('/repos', needDb, wrap(async (_req, res) => {
    const all = [];
    for (let page = 1; page <= 3; page += 1) {
      const list = await gh(`/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner&visibility=all`);
      all.push(...(list || []));
      if (!list || list.length < 100) break;
    }
    const imported = new Set((await Project.find({ 'source.repo': { $exists: true } }).select('source id').lean()).map((p) => p.source.repo));
    res.json(all.filter((x) => !x.archived).map((x) => ({
      full_name: x.full_name, name: x.name, private: !!x.private, description: x.description || '', language: x.language || '',
      homepage: x.homepage || '', pushed_at: x.pushed_at, fork: !!x.fork, imported: imported.has(x.full_name),
    })));
  }));

  r.post('/import', needDb, wrap(async (req, res) => {
    const full = String(req.body?.repo || '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(full)) return res.status(400).json({ message: 'Choose a repository from the list.' });
    if (await Project.exists({ 'source.repo': full })) return res.status(409).json({ message: 'That repository is already in your portfolio.' });
    const repo = await gh(`/repos/${full}`);
    if (!repo) return res.status(404).json({ message: 'GitHub could not find that repository with your token.' });
    const [readmeObj, languages] = await Promise.all([gh(`/repos/${full}/readme`), gh(`/repos/${full}/languages`)]);
    const readme = b64(readmeObj);
    const packages = [];
    for (const dir of ['', 'frontend/', 'client/', 'backend/', 'server/']) {
      const pkg = safeJson(b64(await gh(`/repos/${full}/contents/${dir}package.json`)));
      if (pkg) packages.push(pkg);
      if (packages.length >= 2) break;
    }
    const draft = buildDraft({ repo, readme, packages, languages: languages || {} });
    let note = '';
    if (req.body?.screenshot !== false && draft.links.live) {
      try { draft.screenshots.push(await captureScreenshot(draft.links.live)); } catch (e) { note = e.message; }
    } else if (!draft.links.live) note = 'No live website link was found, so no screenshot was captured. Add the live link and use "Capture from live link".';
    const parsed = projectSchema.safeParse(draft);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
    const id = await uniqueId(parsed.data.title);
    const order = (await Project.countDocuments()) ? ((await Project.findOne().sort({ order: -1 }).lean()).order + 1) : 0;
    // drafts start hidden: you review and publish them yourself
    const row = await Project.create({ id, order, hidden: true, source: { repo: full, private: !!repo.private }, data: { id, ...parsed.data } });
    res.status(201).json({ project: { id: row.id, hidden: true, source: { repo: full, private: !!repo.private }, data: row.data }, note });
  }));

  r.post('/screenshot', needDb, wrap(async (req, res) => {
    res.json({ url: await captureScreenshot(String(req.body?.url || '').trim()) });
  }));

  r.use((err, _req, res, next) => (err instanceof HttpError ? res.status(err.status).json({ message: err.message }) : next(err)));
  return r;
}
