import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Image, Message, Project, Stat, getSettings, pktDay, state } from '../models.js';
import { contactSchema } from '../schemas.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export default function publicRoutes(seed) {
  const r = Router();

  r.get('/health', (_req, res) => res.json({ ok: true, db: state.dbReady }));

  r.get('/site', wrap(async (_req, res) => res.json(await getSettings())));

  r.get('/projects', wrap(async (_req, res) => {
    if (!state.dbReady) return res.json({ owner: seed.owner, projects: seed.projects, source: 'bundled' });
    const rows = await Project.find({ hidden: { $ne: true } }).sort({ order: 1 }).lean();
    res.json({ owner: seed.owner, projects: rows.map((x) => x.data), source: 'database' });
  }));

  r.get('/images/:id', wrap(async (req, res) => {
    if (!state.dbReady || !mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
    const img = await Image.findById(req.params.id).lean();
    if (!img) return res.status(404).end();
    res.set({ 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.send(Buffer.from(img.data.buffer ? img.data.buffer : img.data));
  }));

  const contactLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false,
    message: { message: 'Too many messages from this connection. Please use WhatsApp instead.' },
  });
  r.post('/contact', contactLimiter, wrap(async (req, res) => {
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
    const { website, ...data } = parsed.data;
    if (website) return res.status(201).json({ ok: true }); // silently drop bots
    if (!state.dbReady) return res.status(503).json({ message: 'Messages are temporarily unavailable. Please use WhatsApp or email.' });
    await Message.create({ ...data, ip: req.ip });
    res.status(201).json({ ok: true });
  }));

  const trackSchema = z.object({
    type: z.enum(['visit', 'cta']),
    project: z.string().regex(/^[a-z0-9-]{1,60}$/).optional(),
  });
  const trackLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { message: 'Slow down.' } });
  r.post('/track', trackLimiter, wrap(async (req, res) => {
    const p = trackSchema.safeParse(req.body);
    if (!p.success || !state.dbReady) return res.status(204).end();
    const inc = p.data.type === 'visit' ? { visits: 1 } : p.data.project ? { [`ctas.${p.data.project}`]: 1 } : null;
    if (inc) await Stat.updateOne({ day: pktDay() }, { $inc: inc }, { upsert: true });
    res.status(204).end();
  }));

  return r;
}
