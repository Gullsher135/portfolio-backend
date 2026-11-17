import express, { Router } from 'express';
import mongoose from 'mongoose';
import { Image, Message, Project, Setting, Stat, getSettings, pktDay, state } from '../models.js';
import { loginLimiter, requireAdmin, safeEqual, signToken } from '../auth.js';
import { projectSchema, settingsSchema, slugify } from '../schemas.js';
import { deleteUnusedImages, imageIds, magic, uniqueId } from '../projectUtils.js';
import githubRoutes from './github.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const needDb = (_req, res, next) => (state.dbReady ? next() : res.status(503).json({ message: 'The database is not connected, so the admin panel cannot save changes.' }));
const bad = (res, parsed) => res.status(400).json({ message: parsed.error.issues[0].message });

export default function adminRoutes(seed) {
  const r = Router();

  r.post('/login', loginLimiter, (req, res) => {
    if (!process.env.ADMIN_KEY) return res.status(503).json({ message: 'ADMIN_KEY is not configured on the server.' });
    if (!safeEqual(req.body?.password, process.env.ADMIN_KEY)) return res.status(401).json({ message: 'Wrong password.' });
    res.json({ token: signToken(), expiresInHours: 12 });
  });

  r.use(requireAdmin);
  r.get('/session', (_req, res) => res.json({ ok: true, db: state.dbReady }));

  // ---------- dashboard ----------
  r.get('/stats', needDb, wrap(async (_req, res) => {
    const days = Array.from({ length: 14 }, (_v, i) => pktDay(i - 13));
    const [stats, projects, total, unread] = await Promise.all([
      Stat.find().lean(), Project.find().sort({ order: 1 }).lean(), Message.countDocuments(), Message.countDocuments({ read: false }),
    ]);
    const byDay = Object.fromEntries(stats.map((s) => [s.day, s]));
    const series = days.map((d) => ({ day: d, visits: byDay[d]?.visits || 0 }));
    const interest = {};
    let visitsTotal = 0;
    stats.forEach((s) => {
      visitsTotal += s.visits || 0;
      Object.entries(s.ctas || {}).forEach(([id, n]) => { interest[id] = (interest[id] || 0) + n; });
    });
    const titles = Object.fromEntries(projects.map((p) => [p.id, p.data.title]));
    const top = Object.entries(interest).map(([id, clicks]) => ({ id, title: titles[id] || id, clicks })).sort((a, b) => b.clicks - a.clicks).slice(0, 7);
    res.json({
      visitsTotal, visitsLast7: series.slice(-7).reduce((a, s) => a + s.visits, 0), series, top,
      messages: { total, unread }, projects: { total: projects.length, hidden: projects.filter((p) => p.hidden).length },
    });
  }));

  // ---------- projects ----------
  r.get('/projects', needDb, wrap(async (_req, res) => {
    const rows = await Project.find().sort({ order: 1 }).lean();
    res.json(rows.map((p) => ({ id: p.id, hidden: !!p.hidden, source: p.source ? { repo: p.source.repo, private: !!p.source.private } : null, data: p.data })));
  }));

  r.post('/projects', needDb, wrap(async (req, res) => {
    const parsed = projectSchema.safeParse(req.body?.project);
    if (!parsed.success) return bad(res, parsed);
    const id = await uniqueId(parsed.data.title);
    const order = (await Project.countDocuments()) ? ((await Project.findOne().sort({ order: -1 }).lean()).order + 1) : 0;
    const row = await Project.create({ id, order, hidden: !!req.body.hidden, data: { id, ...parsed.data } });
    res.status(201).json({ id: row.id, hidden: row.hidden, data: row.data });
  }));

  r.put('/projects/order', needDb, wrap(async (req, res) => {
    const ids = req.body?.ids;
    const all = await Project.find().lean();
    if (!Array.isArray(ids) || ids.length !== all.length || new Set(ids).size !== ids.length || !ids.every((id) => all.some((p) => p.id === id))) {
      return res.status(400).json({ message: 'The order list must contain every project exactly once.' });
    }
    await Project.bulkWrite(ids.map((id, order) => ({ updateOne: { filter: { id }, update: { $set: { order } } } })));
    res.json({ ok: true });
  }));

  r.post('/projects/reset', needDb, wrap(async (_req, res) => {
    const old = (await Project.find().lean()).flatMap((p) => imageIds(p.data));
    await Project.deleteMany({});
    await Project.insertMany(seed.projects.map((p, i) => ({ id: p.id, order: i, hidden: false, data: p })));
    await deleteUnusedImages(old);
    res.json({ ok: true, count: seed.projects.length });
  }));

  r.post('/projects/import', needDb, wrap(async (req, res) => {
    const list = req.body?.projects;
    if (!Array.isArray(list) || list.length === 0 || list.length > 40) return res.status(400).json({ message: 'The file must contain a "projects" list with 1 to 40 projects.' });
    const rows = [];
    const used = new Set();
    for (const item of list) {
      const data = item?.data || item;
      const parsed = projectSchema.safeParse(data);
      if (!parsed.success) return res.status(400).json({ message: `"${data?.title || 'A project'}": ${parsed.error.issues[0].message}` });
      let id = slugify(data.id || parsed.data.title);
      for (let i = 2; used.has(id); i += 1) id = `${slugify(data.id || parsed.data.title)}-${i}`;
      used.add(id);
      rows.push({ id, order: rows.length, hidden: !!item.hidden, data: { id, ...parsed.data } });
    }
    const old = (await Project.find().lean()).flatMap((p) => imageIds(p.data));
    await Project.deleteMany({});
    await Project.insertMany(rows);
    await deleteUnusedImages(old);
    res.json({ ok: true, count: rows.length });
  }));

  r.put('/projects/:id', needDb, wrap(async (req, res) => {
    const parsed = projectSchema.safeParse(req.body?.project);
    if (!parsed.success) return bad(res, parsed);
    const existing = await Project.findOne({ id: req.params.id });
    if (!existing) return res.status(404).json({ message: 'Project not found.' });
    const before = imageIds(existing.data);
    existing.data = { id: existing.id, ...parsed.data };
    if (typeof req.body.hidden === 'boolean') existing.hidden = req.body.hidden;
    existing.markModified('data');
    await existing.save();
    const after = new Set(imageIds(existing.data));
    await deleteUnusedImages(before.filter((x) => !after.has(x)));
    res.json({ id: existing.id, hidden: existing.hidden, data: existing.data });
  }));

  r.patch('/projects/:id/visibility', needDb, wrap(async (req, res) => {
    if (typeof req.body?.hidden !== 'boolean') return res.status(400).json({ message: '"hidden" must be true or false.' });
    const row = await Project.findOneAndUpdate({ id: req.params.id }, { hidden: req.body.hidden }, { new: true });
    if (!row) return res.status(404).json({ message: 'Project not found.' });
    res.json({ id: row.id, hidden: row.hidden });
  }));

  r.delete('/projects/:id', needDb, wrap(async (req, res) => {
    const row = await Project.findOneAndDelete({ id: req.params.id });
    if (!row) return res.status(404).json({ message: 'Project not found.' });
    await deleteUnusedImages(imageIds(row.data));
    res.json({ ok: true });
  }));

  r.use('/github', githubRoutes());

  // ---------- images (raw body, the admin panel shrinks them first) ----------
  const rawImage = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '2mb' });
  r.post('/images', needDb, rawImage, wrap(async (req, res) => {
    const mime = req.get('content-type')?.split(';')[0];
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ message: 'Send a JPG, PNG or WebP image.' });
    if (!magic(req.body, mime)) return res.status(400).json({ message: 'That file is not a valid image.' });
    const img = await Image.create({ data: req.body, mime, size: req.body.length, name: String(req.get('x-file-name') || '').slice(0, 120) });
    res.status(201).json({ id: img.id, url: `/api/images/${img.id}` });
  }));

  // screenshots that were uploaded but never saved into a project (older than 30 minutes)
  r.delete('/images/unused', needDb, wrap(async (_req, res) => {
    const old = await Image.find({ createdAt: { $lt: new Date(Date.now() - 30 * 60 * 1000) } }).select('_id').lean();
    let removed = 0;
    for (const { _id } of old) {
      if (!(await Project.exists({ 'data.screenshots': `/api/images/${_id}` }))) { await Image.deleteOne({ _id }); removed += 1; }
    }
    res.json({ removed });
  }));

  // ---------- messages ----------
  r.get('/messages', needDb, wrap(async (req, res) => {
    const q = {};
    if (req.query.status === 'unread') q.read = false;
    if (req.query.q) {
      const rx = new RegExp(String(req.query.q).slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      q.$or = [{ name: rx }, { contact: rx }, { message: rx }, { projectType: rx }];
    }
    res.json(await Message.find(q).sort({ createdAt: -1 }).limit(300).lean());
  }));
  r.patch('/messages/:id', needDb, wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id) || typeof req.body?.read !== 'boolean') return res.status(400).json({ message: 'Invalid request.' });
    res.json(await Message.findByIdAndUpdate(req.params.id, { read: req.body.read }, { new: true }));
  }));
  r.delete('/messages/:id', needDb, wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid id.' });
    await Message.deleteOne({ _id: req.params.id });
    res.json({ ok: true });
  }));

  // ---------- settings ----------
  r.get('/settings', needDb, wrap(async (_req, res) => res.json(await getSettings())));
  r.put('/settings', needDb, wrap(async (req, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return bad(res, parsed);
    await Setting.findOneAndUpdate({ key: 'site' }, { key: 'site', value: parsed.data }, { upsert: true });
    res.json(parsed.data);
  }));

  return r;
}
