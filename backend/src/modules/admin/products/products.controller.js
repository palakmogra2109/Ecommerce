import { 
  getAllProducts, 
  createProduct, 
  getProductById, 
  updateProduct, 
  deleteProduct 
} from './products.service.js';
import { KEY_PERMISSIONS } from '../../../../src/config/constants.js';

export const handleGetProducts = async (req, res) => {
  try {
    const auth = await authorize(KEY_PERMISSIONS.PRODUCTS_VIEW);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    const products = await getAllProducts();
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const handleCreateProduct = async (req, res) => {
  try {
    const auth = await authorize(KEY_PERMISSIONS.PRODUCTS_CREATE);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    const product = await createProduct(req.body);
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const handleGetProduct = async (req, res) => {
  try {
    const auth = await authorize(KEY_PERMISSIONS.PRODUCTS_VIEW);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    const product = await getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const handleUpdateProduct = async (req, res) => {
  try {
    const auth = await authorize(KEY_PERMISSIONS.PRODUCTS_EDIT);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    const product = await updateProduct(req.params.id, req.body);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const handleDeleteProduct = async (req, res) => {
  try {
    const auth = await authorize(KEY_PERMISSIONS.PRODUCTS_EDIT);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    const result = await deleteProduct(req.params.id);
    if (!result) return res.status(404).json({ error: 'Product not found' });
    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
