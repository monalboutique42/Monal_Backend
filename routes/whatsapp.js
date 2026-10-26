import express from 'express';
import pkg from 'whatsapp-web.js';
const { MessageMedia } = pkg;
import { clients, initWhatsApp } from '../utils/whatsapp.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// ✅ 1. Connect (Initialize QR)
router.post('/connect', protect, async (req, res) => {
  try {
    const unitId = req.user.unitNo || req.user._id;
    initWhatsApp(unitId);
    res.json({ success: true, message: 'Initializing...' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ 2. Poll for QR Code / Status
router.get('/code', protect, (req, res) => {
  const unitId = req.user.unitNo || req.user._id;
  const qr = clients[unitId + '_qr'];
  const isReady = clients[unitId + '_ready'];

  if (isReady) return res.json({ connected: true, unitId }); // ✅ unitId anuppu
  res.json({ connected: false, qr }); 
});

// ✅ 3. Check Status
router.get('/status', protect, (req, res) => {
  const unitId = req.user.unitNo || req.user._id;
  const isReady = clients[unitId + '_ready'];
  if (isReady) return res.json({ connected: true, number: 'Connected', unitId });
  res.json({ connected: false });
});

// ✅ 4. Logout / Remove Link
router.post('/logout', protect, async (req, res) => {
  try {
    const unitId = req.user.unitNo || req.user._id;
    const client = clients[unitId];
    
    if (client) {
      try { await client.logout(); } catch (e) {}
      try { await client.destroy(); } catch (e) {}
      
      delete clients[unitId];
      delete clients[unitId + '_ready'];
      delete clients[unitId + '_qr'];
    }
    res.json({ success: true, message: 'Disconnected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ 5. Send Message
router.post('/send', protect, async (req, res) => {
  const { number, message, pdfBase64, fileName, unitId } = req.body; 
  
  const targetUnitId = unitId || req.user.unitNo || req.user._id;
  
  const client = clients[targetUnitId];
  const isReady = clients[targetUnitId + '_ready'];

  if (!isReady || !client) {
    return res.status(400).json({ error: `WhatsApp not connected for unit ${targetUnitId}` });
  }

  try {
    const chatId = number.includes('@c.us') ? number : `91${number.replace(/\D/g, '')}@c.us`;

    if (pdfBase64 && fileName) {
      // ✅ Use the safeSend function (disables sendSeen to prevent crash)
      const media = new MessageMedia('application/pdf', pdfBase64, fileName);
      await client.safeSend(chatId, media, { caption: message });
    } else {
      await client.safeSend(chatId, message);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Send WhatsApp error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;