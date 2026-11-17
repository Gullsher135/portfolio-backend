import mongoose from 'mongoose';

const { Schema } = mongoose;

const projectSchema = new Schema({
  id: { type: String, required: true, unique: true },
  order: { type: Number, default: 0 },
  hidden: { type: Boolean, default: false },
  source: { type: Schema.Types.Mixed }, // { repo, private } for projects imported from GitHub; never sent to the public site
  data: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true });

const messageSchema = new Schema({
  name: String, contact: String, projectType: String, timeline: String, budget: String,
  message: String, fromProject: String, ip: String, read: { type: Boolean, default: false },
}, { timestamps: true });

// Screenshots uploaded from the admin panel live in MongoDB (Render's disk is wiped on every deploy).
const imageSchema = new Schema({ data: Buffer, mime: String, name: String, size: Number }, { timestamps: true });

const settingSchema = new Schema({ key: { type: String, unique: true }, value: Schema.Types.Mixed });

// One document per day (Pakistan time). No IP addresses or personal data are stored.
const statSchema = new Schema({
  day: { type: String, unique: true },
  visits: { type: Number, default: 0 },
  ctas: { type: Schema.Types.Mixed, default: {} },
});

export const Project = mongoose.model('Project', projectSchema);
export const Message = mongoose.model('Message', messageSchema);
export const Image = mongoose.model('Image', imageSchema);
export const Setting = mongoose.model('Setting', settingSchema);
export const Stat = mongoose.model('Stat', statSchema);

export const state = { dbReady: false };

export const DEFAULT_SETTINGS = {
  available: true,
  whatsapp: '923358433067',
  email: 'gullk03351@gmail.com',
  github: 'https://github.com/Gullsher135',
  showCodeLinks: false,
};

export async function getSettings() {
  if (!state.dbReady) return { ...DEFAULT_SETTINGS };
  const row = await Setting.findOne({ key: 'site' }).lean();
  return { ...DEFAULT_SETTINGS, ...(row?.value || {}) };
}

export const pktDay = (offsetDays = 0) => new Date(Date.now() + 5 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
