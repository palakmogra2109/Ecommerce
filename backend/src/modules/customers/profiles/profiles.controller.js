import { getCustomerProfile, updateCustomerProfile } from './profiles.service.js';

export const handleGetProfile = async (req, res) => {
  try {
    const profile = await getCustomerProfile(req.user.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const handleUpdateProfile = async (req, res) => {
  try {
    const profile = await updateCustomerProfile(req.user.id, req.body);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
