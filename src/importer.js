// Turns what GitHub knows about a repository (README, package.json, languages) into a draft portfolio project.
// Everything here is a plain function so it is easy to test and to improve.

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{FE0F}]/gu;

export const cleanText = (s = '') => s
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/\bhttps?:\/\/\S+/g, '')
  .replace(EMOJI, '')
  .replace(/\b_([^_\s][^_]*)_\b/g, '$1')
  .replace(/[`*>#~]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const cut = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/[\s,;:.-]+\S*$/, '')}…`);

export function parseReadme(md = '') {
  if (/This template provides a minimal setup|Getting Started with Create React App|bootstrapped with \[?Create React App/i.test(md)) return { title: '', paragraphs: [], highlights: [] }; // default template text, not a real description
  const lines = md.replace(/\r/g, '').replace(/^---[\s\S]*?---\n/, '').split('\n');
  let title = '';
  const paragraphs = [];
  const lists = []; // { heading, items }
  let heading = '';
  let para = [];
  let list = null;
  let fence = false;
  const flushPara = () => {
    const t = cleanText(para.join(' '));
    if (t.length >= 30 && !/^(table of contents|license|contents)$/i.test(t)) paragraphs.push(t);
    para = [];
  };
  const flushList = () => { if (list?.items.length) lists.push(list); list = null; };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('```')) { fence = !fence; flushPara(); continue; }
    if (fence) continue;
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushPara(); flushList();
      heading = cleanText(h[2]);
      if (h[1] === '#' && !title) title = heading;
      continue;
    }
    const li = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      if (!list) list = { heading, items: [] };
      const t = cleanText(li[1]);
      if (t.length >= 8) list.items.push(t);
      continue;
    }
    if (!line) { flushPara(); continue; }
    if (/^[|<]/.test(line) || /^\[!\[/.test(line) || /^!\[/.test(line)) { flushPara(); continue; }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();

  const skip = /install|setup|set up|run|usage|getting started|deploy|environment|env|license|contribut|scripts|requirements|prerequisite|clone|folder|structure|endpoints|api|vercel|render|build|framework|settings|config|steps|notes|test|troubleshoot|faq/i;
  const noisy = /npm |yarn |pnpm |https?:\/\/|YOUR[-_ ]|\.env|environment variable|build command|output:|localhost|git clone/i;
  const want = /feature|highlight|what it|capabilit|include|provide|can do|functionality|modules/i;
  const pick = lists.find((l) => want.test(l.heading) && l.items.length >= 2) || lists.find((l) => !skip.test(l.heading) && l.items.length >= 3);
  const highlights = (pick?.items || []).filter((t) => !noisy.test(t)).slice(0, 6).map((t) => cut(t.split(/\s[-–—:]\s/)[0].length >= 18 ? t.split(/\s[-–—:]\s/)[0] : t, 120));
  return { title, paragraphs, highlights };
}

const DEPS = [
  ['react', 'React'], ['next', 'Next.js'], ['vue', 'Vue'], ['@angular/core', 'Angular'], ['svelte', 'Svelte'], ['react-native', 'React Native'], ['expo', 'Expo'],
  ['react-router-dom', 'React Router'], ['vite', 'Vite'], ['typescript', 'TypeScript'], ['tailwindcss', 'Tailwind CSS'], ['bootstrap', 'Bootstrap'],
  ['@mui/material', 'Material UI'], ['framer-motion', 'Framer Motion'], ['three', 'Three.js'], ['@react-three/fiber', 'React Three Fiber'],
  ['recharts', 'Recharts'], ['chart.js', 'Chart.js'], ['@reduxjs/toolkit', 'Redux Toolkit'], ['redux', 'Redux'], ['axios', 'Axios'], ['lucide-react', 'Lucide Icons'],
  ['express', 'Express'], ['fastify', 'Fastify'], ['@nestjs/core', 'NestJS'], ['mongoose', 'MongoDB'], ['mongodb', 'MongoDB'], ['pg', 'PostgreSQL'], ['mysql2', 'MySQL'],
  ['prisma', 'Prisma'], ['sequelize', 'Sequelize'], ['firebase', 'Firebase'], ['firebase-admin', 'Firebase'], ['socket.io', 'Socket.IO'], ['socket.io-client', 'Socket.IO'],
  ['jsonwebtoken', 'JWT'], ['multer', 'Multer'], ['nodemailer', 'Nodemailer'], ['stripe', 'Stripe'],
];
const SERVER_DEPS = ['express', 'fastify', '@nestjs/core', 'koa', 'hapi'];

export function stackFromPackages(pkgs, languages = {}) {
  const names = new Set();
  const all = new Set();
  pkgs.forEach((p) => Object.keys({ ...p.dependencies, ...p.devDependencies }).forEach((d) => all.add(d)));
  DEPS.forEach(([dep, label]) => { if (all.has(dep)) names.add(label); });
  if (SERVER_DEPS.some((d) => all.has(d))) names.add('Node.js');
  if (names.size === 0) {
    // not a JavaScript project: fall back to the main languages GitHub detected
    const total = Object.values(languages).reduce((a, b) => a + b, 0) || 1;
    Object.entries(languages).sort((a, b) => b[1] - a[1]).filter(([, n]) => n / total >= 0.08).slice(0, 4)
      .forEach(([l]) => { if (!['HTML', 'CSS', 'Shell', 'Dockerfile'].includes(l)) names.add(l); });
  }
  const order = ['Node.js', ...DEPS.map((d) => d[1])];
  return [...names].sort((a, b) => order.indexOf(a) - order.indexOf(b)).slice(0, 12);
}

const prettyName = (n) => n.replace(/[-_.]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

export function findLiveUrl(repo, readme = '') {
  if (/^https?:\/\//i.test(repo.homepage || '')) return repo.homepage.trim();
  const m = /https?:\/\/[\w.-]+\.(?:vercel\.app|netlify\.app|pages\.dev|web\.app|firebaseapp\.com)[^\s)\]>"']*/i.exec(readme);
  return m ? m[0].replace(/[.,;]+$/, '') : '';
}

export function buildDraft({ repo, readme, packages, languages }) {
  const r = parseReadme(readme);
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const readmeTitle = r.title && r.title.length >= 3 && r.title.length <= 90 && norm(r.title) !== norm(repo.name);
  const title = cut(readmeTitle ? r.title : prettyName(repo.name), 120);
  const stack = stackFromPackages(packages, languages);
  const lead = r.paragraphs[0] || '';
  const fromRepo = cleanText(repo.description || '');
  const tagline = cut(fromRepo || lead || (stack.length ? `Built with ${stack.slice(0, 3).join(', ')}` : `${title} project`), 200);
  // if the tagline already used the first paragraph, the description continues with the next ones
  const rest = fromRepo ? r.paragraphs.slice(0, 2) : r.paragraphs.slice(1, 3);
  const description = cut(rest.join(' ') || lead || fromRepo || tagline, 600);
  const live = findLiveUrl(repo, readme);
  return {
    title,
    tagline,
    description,
    year: new Date(repo.created_at || Date.now()).getFullYear(),
    highlights: r.highlights,
    stack,
    // never put a link to a private repository on a public website
    links: { live, github: repo.private ? '' : repo.html_url || '' },
    screenshots: [],
  };
}
