import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';
import { Project, state } from './models.js';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin.js';

const app = express();
app.set('trust proxy', 1);
// images are loaded by the website on another domain, so they must be allowed cross-origin
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

const allowed = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    // allow tools without an Origin header (curl, health checks) and listed sites
    if (!origin || allowed.includes(origin)) return cb(null, true);
    return cb(new Error('Origin not allowed'));
  },
}));

// the import route accepts a bigger JSON file than everything else
const small = express.json({ limit: '50kb' });
const big = express.json({ limit: '1mb' });
app.use((req, res, next) => (req.path === '/api/admin/projects/import' ? big : small)(req, res, next));

const seed = JSON.parse(readFileSync(new URL('./projects.seed.json', import.meta.url), 'utf8'));

app.use('/api', publicRoutes(seed));
app.use('/api/admin', adminRoutes(seed));

app.use((_req, res) => res.status(404).json({ message: 'Not found' }));
app.use((err, _req, res, _next) => {
  if (err.message === 'Origin not allowed') return res.status(403).json({ message: 'Origin not allowed' });
  if (err.type === 'entity.too.large') return res.status(413).json({ message: 'That upload is too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'The request body is not valid JSON.' });
  console.error(err);
  return res.status(500).json({ message: 'Something went wrong on the server.' });
});

async function connectDb() {
  if (!process.env.MONGODB_URI) {
    console.warn('MONGODB_URI is not set: serving bundled projects, messages and the admin panel cannot save.');
    return;
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    state.dbReady = true;
    if ((await Project.countDocuments()) === 0) {
      await Project.insertMany(seed.projects.map((p, i) => ({ id: p.id, order: i, hidden: false, data: p })));
      console.log('Seeded projects from projects.seed.json');
    }
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
  }
}

const port = process.env.PORT || 5000;
connectDb().finally(() => app.listen(port, () => console.log(`API listening on ${port}`)));
