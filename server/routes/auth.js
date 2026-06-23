import { Router } from 'express';
import jwt from 'jsonwebtoken';

const router = Router();

// POST /api/auth/login — exchange the app password for a 30-day JWT.
router.post('/login', (req, res) => {
  const { password } = req.body || {};

  if (!password || password !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: 'Невірний пароль' });
  }

  const token = jwt.sign({ app: 'fin_monitoring' }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
  res.json({ token });
});

export default router;
