import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;

export const clients = {}; 

export const initWhatsApp = (unitId) => {
  if (clients[unitId]) return clients[unitId];

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: `monal-unit-${unitId}` }),
    
    // ✅ 1. THE MAIN TRICK: Lock WhatsApp Web version (No auto-updates)
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    
    // ✅ 2. Disable the problematic feature that causes the PDF crash
    markChatReadOnMessageSend: false,

    puppeteer: {
      headless: "new",
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      ],
    },
  });

  // ✅ 3. Safe send function (Bypass error)
  const safeSendMessage = async (chatId, content, options = {}) => {
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 sec delay
    try {
      return await client.sendMessage(chatId, content, { ...options, sendSeen: false });
    } catch (err) {
      if (err.message.includes('markedUnread')) {
        const chat = await client.getChatById(chatId);
        return await chat.sendMessage(content, options);
      }
      throw err;
    }
  };

  // Expose safeSendMessage so routes can use it
  client.safeSend = safeSendMessage;

  client.on('qr', (qr) => {
    console.log(`📱 [${unitId}] QR Code Ready`);
    clients[unitId + '_qr'] = qr;
  });

  client.on('ready', () => {
    console.log(`✅ [${unitId}] WhatsApp is READY!`);
    clients[unitId + '_ready'] = true;
    clients[unitId + '_qr'] = null;
  });

  client.on('authenticated', () => {
    console.log(`✅ [${unitId}] Authenticated!`);
    clients[unitId + '_ready'] = true; 
    clients[unitId + '_qr'] = null;
  });

  client.on('auth_failure', (msg) => console.error(`❌ [${unitId}] Auth Failure:`, msg));

  client.on('disconnected', async (reason) => {
    console.log(`❌ [${unitId}] Disconnected:`, reason);
    clients[unitId + '_ready'] = false;
    
    setTimeout(async () => {
      try { await client.destroy(); } catch (err) {}
    }, 2000);

    delete clients[unitId];
    delete clients[unitId + '_ready'];
    delete clients[unitId + '_qr'];
  });

  client.initialize().catch(err => console.error(`❌ [${unitId}] Init error:`, err.message));
  clients[unitId] = client;
  return client;
};