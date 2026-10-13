import { Router } from 'express';
import { handleGetProfile, handleUpdateProfile } from './profiles.controller.js';

const router = Router();

// Customer profile routes - protected
router.get('/', handleGetProfile);
router.put('/', handleUpdateProfile);

export default router;
