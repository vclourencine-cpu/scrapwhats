const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { initWhatsApp, scrapeGroups } = require('./whatsapp-client');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename.replace(/[^a-zA-Z0-9_\-\.]/g, '');
    const filepath = path.join(__dirname, filename);
    if (fs.existsSync(filepath)) {
        res.download(filepath);
    } else {
        res.status(404).json({ error: 'Arquivo não encontrado' });
    }
});

wss.on('connection', (ws) => {
    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.type === 'init') {
                await initWhatsApp(ws);
            } else if (msg.type === 'scrape') {
                await scrapeGroups(ws, msg.selectedGroups, msg.config);
            }
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', message: err.message }));
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 ScrapWhats | iatize CRM`);
    console.log(`   Acesse: http://localhost:${PORT}\n`);
});
