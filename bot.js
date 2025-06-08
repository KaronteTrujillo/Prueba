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
app.use(express.json());

const mediaDir = path.join(__dirname, 'media');
if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir);
}

let mediaList = [];
let albums = {};

const loadData = () => {
  if (fs.existsSync('media.json')) {
    mediaList = JSON.parse(fs.readFileSync('media.json'));
  }
  if (fs.existsSync('albums.json')) {
    albums = JSON.parse(fs.readFileSync('albums.json'));
  }
};
loadData();

const saveData = () => {
  fs.writeFileSync('media.json', JSON.stringify(mediaList, null, 2));
  fs.writeFileSync('albums.json', JSON.stringify(albums, null, 2));
};

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
    if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
    if (msg.messageStubType) return;

    let mediaUrl = null;
    let mediaType = null;
    let fileName = null;

    const messageContent = msg.message;

    if (messageContent.imageMessage) {
        mediaType = 'image';
        fileName = `image-${Date.now()}.jpg`;
    } else if (messageContent.videoMessage) {
        mediaType = 'video';
        fileName = `video-${Date.now()}.mp4`;
    } else if (messageContent.audioMessage) {
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

            const mediaItem = {
                id: Date.now().toString(),
                type: mediaType,
                url: mediaUrl,
                sender: msg.key.remoteJid,
                timestamp: new Date(),
                isViewOnce: false, // Ya no distinguimos "ver una vez"
                album: null,
            };
            mediaList.push(mediaItem);
            saveData();
            io.emit('newMedia', mediaItem);
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

app.get('/media', (req, res) => {
  res.json(mediaList);
});

app.delete('/media/:id', (req, res) => {
  const { id } = req.params;
  const media = mediaList.find((m) => m.id === id);
  if (media) {
    try {
      fs.unlinkSync(path.join(mediaDir, path.basename(media.url)));
      mediaList = mediaList.filter((m) => m.id !== id);
      saveData();
      io.emit('mediaDeleted', id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Error al eliminar el archivo' });
    }
  } else {
    res.status(404).json({ error: 'Archivo no encontrado' });
  }
});

app.post('/album', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre del álbum requerido' });
  albums[name] = albums[name] || [];
  saveData();
  io.emit('albumsUpdated', albums);
  res.json({ success: true, albums });
});

app.post('/media/:id/album', (req, res) => {
  const { id } = req.params;
  const { album } = req.body;
  const media = mediaList.find((m) => m.id === id);
  if (media && (albums[album] || album === null)) {
    media.album = album;
    if (album && !albums[album].includes(id)) {
      albums[album].push(id);
    }
    saveData();
    io.emit('mediaUpdated', media);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Archivo o álbum no encontrado' });
  }
});

app.get('/albums', (req, res) => {
  res.json(albums);
});

server.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
  connectToWhatsApp();
});
