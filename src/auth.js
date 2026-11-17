import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { timingSafeEqual } from 'node:crypto';

export const safeEqual = (a = '', b = '') => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

const secret = () => process.env.JWT_SECRET || process.env.ADMIN_KEY;
export const signToken = () => jwt.sign({ role: 'admin' }, secret(), { expiresIn: '12h' });

// Only failed attempts count, so you can never lock yourself out by logging in normally.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many wrong passwords. Try again in 15 minutes.' },
});

export const requireAdmin = (req, res, next) => {
  if (!process.env.ADMIN_KEY) return res.status(503).json({ message: 'ADMIN_KEY is not configured on the server.' });
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) {
    try {
      jwt.verify(header.slice(7), secret());
      return next();
    } catch {
      return res.status(401).json({ message: 'Your session expired. Please log in again.' });
    }
  }
  // scripts (curl) can still send the key directly
  if (safeEqual(req.get('x-admin-key'), process.env.ADMIN_KEY)) return next();
  return res.status(401).json({ message: 'Please log in.' });
};
