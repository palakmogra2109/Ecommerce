import { getStoreProducts, getProductBySku } from './products.service.js';

export const handleGetStoreProducts = async (req, res) => {
  try {
    const filters = {
      category: req.query.category,
      brand: req.query.brand,
      search: req.query.search,
    };
    const products = await getStoreProducts(filters);
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const handleGetProductBySku = async (req, res) => {
  try {
    const product = await getProductBySku(req.params.sku);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
