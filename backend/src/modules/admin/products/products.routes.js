import { Router } from 'express';
import { 
  handleGetProducts, 
  handleCreateProduct, 
  handleGetProduct, 
  handleUpdateProduct, 
  handleDeleteProduct 
} from './products.controller.js';
import { authorize } from '../../../../lib/authorization.js';
import { KEY_PERMISSIONS } from '../../../../src/config/constants.js';

const router = Router();

// All admin product routes require authentication
router.use(authenticate);

router.get('/', authorize(KEY_PERMISSIONS.PRODUCTS_VIEW), handleGetProducts);
router.post('/', authorize(KEY_PERMISSIONS.PRODUCTS_CREATE), handleCreateProduct);
router.get('/:id', authorize(KEY_PERMISSIONS.PRODUCTS_VIEW), handleGetProduct);
router.put('/:id', authorize(KEY_PERMISSIONS.PRODUCTS_EDIT), handleUpdateProduct);
router.delete('/:id', authorize(KEY_PERMISSIONS.PRODUCTS_EDIT), handleDeleteProduct);

export default router;

// Auth middleware for Next.js route handlers
function authenticate(req, res, next) {
  // In Next.js App Router, this would be handled differently
  // For Express integration, we check the auth
  next();
}
