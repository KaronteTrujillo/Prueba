const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
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
      console.log('Escanea este código QR con tu WhatsApp:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      console.log('¡Conectado a WhatsApp!');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.remoteJid === 'status@broadcast') return; // Ignorar estados
    if (msg.messageStubType) return; // Ignorar notificaciones de historial

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
      try {
        const buffer = await downloadMediaMessage(
          msg,
          'buffer',
          {},
          { logger: console, reuploadRequest: sock.updateMediaMessage }
        );

        const filePath = path.join(mediaDir, fileName);
        fs.writeFileSync(filePath, buffer);

        mediaUrl = `/media/${fileName}`;
        mediaList.push({ type: mediaType, url: mediaUrl, sender: msg.key.remoteJid, timestamp: new Date() });

        // Emitir el nuevo archivo multimedia a la interfaz web
        io.emit('newMedia', { type: mediaType, url: mediaUrl, sender: msg.key.remoteJid, timestamp: new Date() });
        console.log(`Recibido ${mediaType} de ${msg.key.remoteJid}, guardado como ${fileName}`);
      } catch (error) {
        console.error(`Error al descargar multimedia: ${error.message}`);
      }
    }
  });

  rl.question('Ingresa tu número de WhatsApp (ejemplo, +1234567890): ', (phoneNumber) => {
    console.log(`Conectando con el número: ${phoneNumber}`);
  });
}

server.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
  connectToWhatsApp();
});

app.get('/media', (req, res) => {
  res.json(mediaList);
});
