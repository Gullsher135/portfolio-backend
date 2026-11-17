import { z } from 'zod';

const url = z.string().trim().max(300).refine((v) => v === '' || /^https?:\/\//i.test(v), 'Links must start with http:// or https://').optional().default('');
const shot = z.string().trim().max(400).refine(
  (v) => /^(\/screenshots\/[\w./-]+|\/api\/images\/[a-f0-9]{24}|https:\/\/\S+)$/.test(v),
  'Screenshot must be an uploaded image or an https link',
);

export const projectSchema = z.object({
  title: z.string().trim().min(2, 'Give the project a title').max(120),
  tagline: z.string().trim().max(220).optional().default(''),
  description: z.string().trim().max(2500).optional().default(''),
  year: z.coerce.number().int().min(2000).max(2100).optional().default(new Date().getFullYear()),
  highlights: z.array(z.string().trim().min(1).max(220)).max(8, 'At most 8 highlights').optional().default([]),
  stack: z.array(z.string().trim().min(1).max(40)).max(20, 'At most 20 technologies').optional().default([]),
  links: z.object({ live: url, github: url, githubBackend: url, githubLanding: url }).partial().optional().default({}),
  screenshots: z.array(shot).max(8, 'At most 8 screenshots').optional().default([]),
});

export const settingsSchema = z.object({
  available: z.boolean(),
  whatsapp: z.string().trim().regex(/^\d{8,15}$/, 'WhatsApp number: digits only, with country code (example 923358433067)'),
  email: z.string().trim().email('Enter a valid email').max(120),
  github: url,
  showCodeLinks: z.boolean(),
});

export const contactSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your name').max(80),
  contact: z.string().trim().min(5, 'Enter an email or WhatsApp number').max(120),
  projectType: z.string().trim().max(60).optional().default(''),
  timeline: z.string().trim().max(60).optional().default(''),
  budget: z.string().trim().max(60).optional().default(''),
  message: z.string().trim().min(10, 'Tell me a little more about the project (10+ characters)').max(2000),
  fromProject: z.string().trim().max(80).optional().default(''),
  website: z.string().optional().default(''), // honeypot: real people leave this empty
});

export const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'project';
