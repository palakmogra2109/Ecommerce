import { Router } from 'express';
import { handleGetStoreProducts, handleGetProductBySku } from './products.controller.js';

const router = Router();

router.get('/', handleGetStoreProducts);
router.get('/:sku', handleGetProductBySku);

export default router;
