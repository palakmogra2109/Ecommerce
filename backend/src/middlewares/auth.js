// Global authentication middleware for Next.js middleware or Express
import { NextResponse } from 'next/server';

export const authMiddleware = async (req, res, next) => {
  try {
    // Auth logic here - check token, session, etc.
    const authHeader = req.headers.get('authorization') || '';
    // Validate token, attach user to req, etc.
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized' });
  }
};
