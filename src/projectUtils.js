import { Image, Project } from './models.js';
import { slugify } from './schemas.js';

export const imageIds = (data) => (data?.screenshots || []).map((s) => /^\/api\/images\/([a-f0-9]{24})$/.exec(s)?.[1]).filter(Boolean);

export async function deleteUnusedImages(ids) {
  for (const id of new Set(ids)) {
    const stillUsed = await Project.exists({ 'data.screenshots': `/api/images/${id}` });
    if (!stillUsed) await Image.deleteOne({ _id: id });
  }
}

export async function uniqueId(title) {
  const base = slugify(title);
  let id = base;
  for (let i = 2; await Project.exists({ id }); i += 1) id = `${base}-${i}`;
  return id;
}

export const magic = (b, mime) => (mime === 'image/jpeg' ? b[0] === 0xff && b[1] === 0xd8
  : mime === 'image/png' ? b.subarray(0, 4).toString('hex') === '89504e47'
    : b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP');
