
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const readline = require('readline');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use('/media', express.static(path.join(__dirname, 'media')));
app.use(express.static(path.join(__dirname, 'public')));

const mediaDir = path.join(__dirname, 'media');
if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir);
}

let mediaList = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('Scan this QR code with your WhatsApp:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      console.log('Connected to WhatsApp!');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    let mediaUrl = null;
    let mediaType = null;
    let fileName = null;

    if (msg.message.imageMessage) {
      mediaType = 'image';
      fileName = `image-${Date.now()}.jpg`;
    } else if (msg.message.videoMessage) {
      mediaType = 'video';
      fileName = `video-${Date.now()}.mp4`;
    } else if (msg.message.audioMessage) {
      mediaType = 'audio';
      fileName = `audio-${Date.now()}.mp3`;
    }

    if (mediaType) {
      const mediaData = await sock.downloadMediaMessage(msg);
      const filePath = path.join(mediaDir, fileName);
      fs.writeFileSync(filePath, mediaData);

      mediaUrl = `/media/${fileName}`;
      mediaList.push({ type: mediaType, url: mediaUrl, sender: msg.key.remoteJid, timestamp: new Date() });

      io.emit('newMedia', { type: mediaType, url: mediaUrl, sender: msg.key.remoteJid, timestamp: new Date() });
      console.log(`Received ${mediaType} from ${msg.key.remoteJid}, saved as ${fileName}`);
    }
  });

  rl.question('Enter your WhatsApp phone number (e.g., +1234567890): ', (phoneNumber) => {
    console.log(`Connecting with phone number: ${phoneNumber}`);
  });
}

server.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
  connectToWhatsApp();
});

app.get('/media', (req, res) => {
  res.json(mediaList);
});
