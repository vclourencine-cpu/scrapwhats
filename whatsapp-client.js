const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const XLSX = require('xlsx');
const fs = require('fs');

let activeClient = null;
let storedGroups = null;
let currentWs = null;

function send(ws, type, data = {}) {
    const target = ws || currentWs;
    if (target && target.readyState === 1) {
        target.send(JSON.stringify({ type, ...data }));
    }
}

function log(ws, message, level = 'info') {
    send(ws, 'log', { message, level });
    console.log(`[${level.toUpperCase()}] ${message}`);
}

async function initWhatsApp(ws) {
    currentWs = ws;

    // Already connected — just resend groups
    if (activeClient && storedGroups) {
        send(ws, 'ready', {});
        send(ws, 'groups', { groups: buildGroupsList(storedGroups) });
        return;
    }

    if (activeClient) {
        try { await activeClient.destroy(); } catch {}
        activeClient = null;
    }

    const client = new Client({
        authStrategy: new LocalAuth({ dataPath: './session' }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
            ]
        }
    });
    activeClient = client;

    client.on('qr', async (qr) => {
        try {
            const dataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
            send(ws, 'qr', { qr: dataUrl });
        } catch (err) {
            log(ws, 'Erro ao gerar QR: ' + err.message, 'error');
        }
    });

    client.on('authenticated', () => {
        send(ws, 'authenticated', {});
        log(ws, 'Autenticado com sucesso!');
    });

    client.on('auth_failure', (msg) => {
        send(ws, 'error', { message: 'Falha na autenticação: ' + msg });
    });

    client.on('disconnected', (reason) => {
        send(ws, 'disconnected', { reason });
        activeClient = null;
        storedGroups = null;
        log(ws, 'Desconectado: ' + reason, 'warn');
    });

    client.on('ready', async () => {
        send(ws, 'ready', {});
        log(ws, 'Conectado ao WhatsApp!');

        try {
            log(ws, 'Carregando lista de grupos...');
            const chats = await client.getChats();
            const groups = chats.filter(c => c.isGroup);
            storedGroups = groups;
            send(ws, 'groups', { groups: buildGroupsList(groups) });
            log(ws, `${groups.length} grupos encontrados`, 'success');
        } catch (err) {
            send(ws, 'error', { message: 'Erro ao carregar grupos: ' + err.message });
        }
    });

    client.initialize().catch(err => {
        send(ws, 'error', { message: 'Erro ao inicializar: ' + err.message });
    });
}

function buildGroupsList(groups) {
    return groups.map((g, i) => ({
        index: i,
        id: g.id._serialized,
        name: g.name,
        members: g.groupMetadata?.participants?.length || 0
    }));
}

async function scrapeGroups(ws, selectedGroupIds, config) {
    if (!activeClient) {
        send(ws, 'error', { message: 'WhatsApp não está conectado.' });
        return;
    }

    let groups = (storedGroups || []).filter(g => selectedGroupIds.includes(g.id._serialized));

    if (config?.randomOrder) groups = groups.sort(() => Math.random() - 0.5);

    if (config?.incrementalMode) {
        const stateFile = './incremental-state.json';
        let done = [];
        if (fs.existsSync(stateFile)) {
            try { done = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
        }
        const remaining = groups.filter(g => !done.includes(g.id._serialized));
        if (remaining.length === 0) fs.writeFileSync(stateFile, JSON.stringify([]));
        groups = (remaining.length === 0 ? groups : remaining).slice(0, 5);
    }

    send(ws, 'scraping_start', { total: groups.length });
    log(ws, `Iniciando varredura de ${groups.length} grupo(s)...`);

    const cacheFile = './cache.json';
    let cache = {};
    if (config?.useCache && fs.existsSync(cacheFile)) {
        try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
    }

    const wb = XLSX.utils.book_new();
    let totalContacts = 0;
    let pauseCount = 0;

    for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const groupName = group.name;

        log(ws, `[${i + 1}/${groups.length}] Varrendo: ${groupName}`);
        send(ws, 'progress', {
            current: i + 1,
            total: groups.length,
            percent: Math.round(((i + 1) / groups.length) * 100),
            groupName,
        });

        const participants = group.groupMetadata?.participants || [];
        const rows = [];

        for (const participant of participants) {
            const number = participant.id.user;
            const fullId = participant.id._serialized;

            let nome = '';
            let statusNome = 'Sem Nome';

            if (config?.skipNameLookup) {
                statusNome = 'Busca desativada';
            } else if (config?.useCache && cache[number]) {
                const cached = cache[number];
                nome = typeof cached === 'object' ? (cached.nome || '') : cached;
                statusNome = typeof cached === 'object' ? (cached.status || 'Sem Nome') : (cached ? 'Salvo na Agenda' : 'Sem Nome');
            } else {
                try {
                    const contact = await activeClient.getContactById(fullId);
                    if (contact.name) {
                        nome = contact.name;
                        statusNome = 'Salvo na Agenda';
                    } else if (contact.pushname) {
                        nome = contact.pushname;
                        statusNome = 'Nome do WhatsApp';
                    } else {
                        statusNome = 'Sem Nome';
                    }

                    if (config?.useCache) {
                        cache[number] = { nome, status: statusNome };
                    }

                    if (config?.randomDelays) {
                        await sleep(800 + Math.random() * 2400);
                    }
                } catch {
                    statusNome = 'Erro na consulta';
                }
            }

            rows.push({ Telefone: number, Nome: nome, 'Status do Nome': statusNome });
        }

        totalContacts += rows.length;

        const sheetName = sanitizeSheetName(groupName).substring(0, 31);
        const sheet = XLSX.utils.json_to_sheet(rows, { header: ['Telefone', 'Nome', 'Status do Nome'] });
        sheet['!cols'] = [{ wch: 20 }, { wch: 35 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(wb, sheet, sheetName);

        if (config?.useCache) {
            try { fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2)); } catch {}
        }

        if (config?.incrementalMode) {
            const stateFile = './incremental-state.json';
            let done = [];
            if (fs.existsSync(stateFile)) {
                try { done = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
        }
            done.push(group.id._serialized);
            fs.writeFileSync(stateFile, JSON.stringify(done));
        }

        pauseCount++;
        if (config?.longPauses && pauseCount % 10 === 0) {
            const pauseMs = 15000 + Math.random() * 15000;
            log(ws, `Pausa de segurança: ${Math.round(pauseMs / 1000)}s...`, 'warn');
            await sleep(pauseMs);
        }
    }

    const filename = `contatos_${timestamp()}.xlsx`;
    XLSX.writeFile(wb, filename);

    log(ws, `Concluído! ${totalContacts} contatos extraídos.`, 'success');
    send(ws, 'done', { filename, totalContacts, totalGroups: groups.length });
}

function sanitizeSheetName(name) {
    return (name || 'Grupo').replace(/[\\\/\?\*\[\]\:]/g, '_') || 'Grupo';
}

function timestamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { initWhatsApp, scrapeGroups };
