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

    // Destroy previous client if exists
    if (activeClient) {
        try { await activeClient.destroy(); } catch {}
        activeClient = null;
    }

    const client = new Client({
        authStrategy: new LocalAuth({ dataPath: './session' }),
        puppeteer: {
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
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
    if (!activeClient || !storedGroups) {
        send(ws, 'error', { message: 'Cliente não conectado ou grupos não carregados' });
        return;
    }

    let workGroups = storedGroups.filter(g => selectedGroupIds.includes(g.id._serialized));

    if (workGroups.length === 0) {
        send(ws, 'error', { message: 'Nenhum grupo selecionado' });
        return;
    }

    // 1. Ordem aleatória
    if (config.randomOrder) {
        workGroups = shuffle(workGroups);
        log(ws, 'Protocolo: ordem aleatória aplicada');
    }

    // 2. Modo incremental
    if (config.incrementalMode) {
        const state = loadIncrementalState();
        const done = new Set(state.completedGroupIds || []);
        const pending = workGroups.filter(g => !done.has(g.id._serialized));

        if (pending.length === 0) {
            log(ws, 'Modo incremental: todos os grupos já processados. Resetando estado...', 'warn');
            saveIncrementalState({ completedGroupIds: [] });
        } else {
            const limit = 5;
            workGroups = pending.slice(0, limit);
            log(ws, `Modo incremental: ${workGroups.length} grupos nesta execução (${pending.length} pendentes)`);
        }
    }

    // 3. Cache
    const rawCache = config.useCache ? loadCache() : {};
    // Migra cache antigo (string) para novo formato { nome, status }
    const cache = {};
    for (const [k, v] of Object.entries(rawCache)) {
        cache[k] = typeof v === 'string' ? { nome: v, status: v ? 'Nome do WhatsApp' : 'Sem Nome' } : v;
    }
    const cacheSize = Object.keys(cache).length;
    if (config.useCache && cacheSize > 0) {
        log(ws, `Cache carregado: ${cacheSize} contatos já conhecidos`);
    }

    send(ws, 'scraping_start', { total: workGroups.length });

    const wb = XLSX.utils.book_new();
    let totalContacts = 0;

    for (let i = 0; i < workGroups.length; i++) {
        const group = workGroups[i];

        send(ws, 'progress', {
            current: i + 1,
            total: workGroups.length,
            groupName: group.name,
            percent: Math.round((i / workGroups.length) * 100)
        });

        log(ws, `[${i + 1}/${workGroups.length}] ${group.name}`);

        // Pausa longa a cada 10 grupos
        if (config.longPauses && i > 0 && i % 10 === 0) {
            const ms = 15000 + Math.floor(Math.random() * 15000);
            log(ws, `Pausa de segurança: ${Math.round(ms / 1000)}s...`, 'warn');
            await sleep(ms);
        }

        try {
            const participants = group.groupMetadata?.participants || [];
            const rows = [];

            for (const participant of participants) {
                const number = participant.id.user;
                const fullId = participant.id._serialized;
                let nome = '';
                let statusNome = 'Sem Nome';

                if (config.skipNameLookup) {
                    statusNome = 'Busca desativada';
                } else if (config.useCache && cache[number] !== undefined) {
                    nome = cache[number].nome || '';
                    statusNome = cache[number].status || 'Sem Nome';
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
                            nome = '';
                            statusNome = 'Sem Nome';
                        }
                        if (config.useCache) cache[number] = { nome, status: statusNome };
                    } catch {
                        nome = '';
                        statusNome = 'Erro na consulta';
                    }

                    if (config.randomDelays) {
                        await sleep(randomDelay());
                    }
                }

                rows.push({ Telefone: number, Nome: nome, 'Status do Nome': statusNome });
            }

            totalContacts += rows.length;
            log(ws, `   → ${rows.length} contatos extraídos`);

            // Adiciona aba no Excel
            const sheetName = sanitizeSheetName(group.name).substring(0, 31) || `Grupo_${i + 1}`;
            const ws_sheet = XLSX.utils.json_to_sheet(rows, { header: ['Telefone', 'Nome', 'Status do Nome'] });
            ws_sheet['!cols'] = [{ wch: 20 }, { wch: 35 }, { wch: 20 }];
            XLSX.utils.book_append_sheet(wb, ws_sheet, sheetName);

            // Salva cache periodicamente
            if (config.useCache) saveCache(cache);

            // Atualiza estado incremental
            if (config.incrementalMode) {
                const state = loadIncrementalState();
                const ids = new Set(state.completedGroupIds || []);
                ids.add(group.id._serialized);
                saveIncrementalState({ completedGroupIds: Array.from(ids) });
            }

        } catch (err) {
            log(ws, `Erro em "${group.name}": ${err.message}`, 'error');
        }

        // Delay entre grupos
        if (i < workGroups.length - 1) {
            const delay = config.randomDelays ? randomDelay() : 500;
            await sleep(delay);
        }
    }

    send(ws, 'progress', { current: workGroups.length, total: workGroups.length, groupName: 'Concluído', percent: 100 });

    const filename = `contatos_${timestamp()}.xlsx`;
    XLSX.writeFile(wb, filename);

    log(ws, `Concluído! ${totalContacts} contatos em ${workGroups.length} grupos`, 'success');
    send(ws, 'done', { filename, totalContacts, totalGroups: workGroups.length });
}

// --- Helpers ---

function randomDelay() {
    return 800 + Math.floor(Math.random() * 2400);
}

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function sanitizeSheetName(name) {
    return (name || '').replace(/[\\\/\?\*\[\]\:]/g, '_');
}

function loadCache() {
    try {
        if (fs.existsSync('./cache.json')) return JSON.parse(fs.readFileSync('./cache.json', 'utf-8'));
    } catch {}
    return {};
}

function saveCache(cache) {
    fs.writeFileSync('./cache.json', JSON.stringify(cache), 'utf-8');
}

function loadIncrementalState() {
    try {
        if (fs.existsSync('./incremental-state.json')) return JSON.parse(fs.readFileSync('./incremental-state.json', 'utf-8'));
    } catch {}
    return { completedGroupIds: [] };
}

function saveIncrementalState(state) {
    fs.writeFileSync('./incremental-state.json', JSON.stringify(state), 'utf-8');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function timestamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

module.exports = { initWhatsApp, scrapeGroups };
