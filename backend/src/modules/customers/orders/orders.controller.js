import { getCustomerOrders, getOrderById } from './orders.service.js';

export const handleGetCustomerOrders = async (req, res) => {
  try {
    const orders = await getCustomerOrders(req.user.id);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const handleGetOrder = async (req, res) => {
  try {
    const order = await getOrderById(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
