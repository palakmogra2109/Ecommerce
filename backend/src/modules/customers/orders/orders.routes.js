import { Router } from 'express';
import { handleGetCustomerOrders, handleGetOrder } from './orders.controller.js';

const router = Router();

router.get('/', handleGetCustomerOrders);
router.get('/:orderId', handleGetOrder);

export default router;
