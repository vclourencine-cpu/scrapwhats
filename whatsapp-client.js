const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, makeInMemoryStore, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const QRCode = require('qrcode')
const XLSX = require('xlsx')
const pino = require('pino')
const fs = require('fs')

let activeSock = null
let store = null
let currentWs = null
let storedGroups = null

function send(ws, type, data = {}) {
    const target = ws || currentWs
    if (target && target.readyState === 1) {
        target.send(JSON.stringify({ type, ...data }))
    }
}

function log(ws, message, level = 'info') {
    send(ws, 'log', { message, level })
    console.log(`[${level.toUpperCase()}] ${message}`)
}

async function initWhatsApp(ws) {
    currentWs = ws

    // Already connected — resend groups
    if (activeSock && storedGroups) {
        send(ws, 'ready', {})
        send(ws, 'groups', { groups: buildGroupsList(storedGroups) })
        return
    }

    if (activeSock) {
        try { activeSock.end(undefined) } catch {}
        activeSock = null
    }

    const { state, saveCreds } = await useMultiFileAuthState('./session')

    let version
    try {
        const result = await fetchLatestBaileysVersion()
        version = result.version
    } catch {
        version = [2, 3000, 1023064315]
    }

    store = makeInMemoryStore({ logger: pino({ level: 'silent' }) })

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['ScrapWhats', 'Chrome', '1.0.0'],
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
    })

    store.bind(sock.ev)
    activeSock = sock

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            try {
                const dataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 })
                send(ws, 'qr', { qr: dataUrl })
                log(ws, 'QR Code gerado — aguardando leitura...')
            } catch (err) {
                log(ws, 'Erro ao gerar QR: ' + err.message, 'error')
            }
        }

        if (connection === 'open') {
            send(ws, 'authenticated', {})
            log(ws, 'Autenticado com sucesso!')

            try {
                log(ws, 'Carregando lista de grupos...')
                const groupsObj = await sock.groupFetchAllParticipating()
                const groups = Object.values(groupsObj)
                storedGroups = groups
                send(ws, 'ready', {})
                send(ws, 'groups', { groups: buildGroupsList(groups) })
                log(ws, `${groups.length} grupos encontrados`, 'success')
            } catch (err) {
                send(ws, 'error', { message: 'Erro ao carregar grupos: ' + err.message })
            }
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error instanceof Boom)
                ? lastDisconnect.error.output?.statusCode
                : undefined
            const loggedOut = statusCode === DisconnectReason.loggedOut

            activeSock = null
            storedGroups = null

            if (loggedOut) {
                send(ws, 'disconnected', { reason: 'Sessão encerrada. Escaneie o QR novamente.' })
            } else {
                log(ws, 'Conexão perdida. Reconectando...', 'warn')
                setTimeout(() => initWhatsApp(ws), 3000)
            }
        }
    })
}

function buildGroupsList(groups) {
    return groups.map((g, i) => ({
        index: i,
        id: g.id,
        name: g.subject || g.id,
        members: g.participants?.length || 0
    }))
}

async function scrapeGroups(ws, selectedGroupIds, config) {
    if (!activeSock) {
        send(ws, 'error', { message: 'WhatsApp não está conectado.' })
        return
    }

    let groups = (storedGroups || []).filter(g => selectedGroupIds.includes(g.id))

    if (config?.randomOrder) {
        groups = groups.sort(() => Math.random() - 0.5)
    }

    if (config?.incrementalMode) {
        const stateFile = './incremental-state.json'
        let done = []
        if (fs.existsSync(stateFile)) {
            try { done = JSON.parse(fs.readFileSync(stateFile, 'utf8')) } catch {}
        }
        const remaining = groups.filter(g => !done.includes(g.id))
        groups = (remaining.length === 0 ? groups : remaining).slice(0, 5)
        if (remaining.length === 0) {
            fs.writeFileSync(stateFile, JSON.stringify([]))
        }
    }

    send(ws, 'scraping_start', { total: groups.length })
    log(ws, `Iniciando varredura de ${groups.length} grupo(s)...`)

    // Cache
    const cacheFile = './cache.json'
    let cache = {}
    if (config?.useCache && fs.existsSync(cacheFile)) {
        try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) } catch {}
    }

    const wb = XLSX.utils.book_new()
    let totalContacts = 0
    let pauseCount = 0

    for (let i = 0; i < groups.length; i++) {
        const group = groups[i]
        const groupName = group.subject || group.id

        log(ws, `[${i + 1}/${groups.length}] Varrendo: ${groupName}`)
        send(ws, 'progress', {
            current: i + 1,
            total: groups.length,
            percent: Math.round(((i + 1) / groups.length) * 100),
            groupName,
        })

        const rows = []

        try {
            const metadata = await activeSock.groupMetadata(group.id)
            const participants = metadata.participants || []

            for (const participant of participants) {
                const jid = participant.id
                const phone = jid.split('@')[0]

                let nome = ''
                let statusNome = 'Sem Nome'

                if (config?.skipNameLookup) {
                    statusNome = 'Busca desativada'
                } else if (config?.useCache && cache[phone]) {
                    const cached = cache[phone]
                    nome = typeof cached === 'object' ? (cached.nome || '') : cached
                    statusNome = typeof cached === 'object' ? (cached.status || 'Sem Nome') : (cached ? 'Salvo na Agenda' : 'Sem Nome')
                } else {
                    try {
                        const contact = store?.contacts?.[jid]
                        if (contact?.name) {
                            nome = contact.name
                            statusNome = 'Salvo na Agenda'
                        } else if (contact?.notify) {
                            nome = contact.notify
                            statusNome = 'Nome do WhatsApp'
                        } else {
                            statusNome = 'Sem Nome'
                        }

                        if (config?.useCache) {
                            cache[phone] = { nome, status: statusNome }
                        }

                        if (config?.randomDelays) {
                            await sleep(800 + Math.random() * 2400)
                        }
                    } catch {
                        statusNome = 'Erro na consulta'
                    }
                }

                rows.push({ Telefone: phone, Nome: nome, 'Status do Nome': statusNome })
            }
        } catch (err) {
            log(ws, `Erro ao processar ${groupName}: ${err.message}`, 'error')
        }

        totalContacts += rows.length

        const sheetName = sanitizeSheetName(groupName).substring(0, 31)
        const sheet = XLSX.utils.json_to_sheet(rows, { header: ['Telefone', 'Nome', 'Status do Nome'] })
        sheet['!cols'] = [{ wch: 20 }, { wch: 35 }, { wch: 20 }]
        XLSX.utils.book_append_sheet(wb, sheet, sheetName)

        if (config?.useCache) {
            try { fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2)) } catch {}
        }

        if (config?.incrementalMode) {
            const stateFile = './incremental-state.json'
            let done = []
            if (fs.existsSync(stateFile)) {
                try { done = JSON.parse(fs.readFileSync(stateFile, 'utf8')) } catch {}
            }
            done.push(group.id)
            fs.writeFileSync(stateFile, JSON.stringify(done))
        }

        pauseCount++
        if (config?.longPauses && pauseCount % 10 === 0) {
            const pauseMs = 15000 + Math.random() * 15000
            log(ws, `Pausa de segurança: ${Math.round(pauseMs / 1000)}s...`, 'warn')
            await sleep(pauseMs)
        }
    }

    const filename = `contatos_${timestamp()}.xlsx`
    XLSX.writeFile(wb, filename)

    log(ws, `Concluído! ${totalContacts} contatos extraídos.`, 'success')
    send(ws, 'done', { filename, totalContacts, totalGroups: groups.length })
}

function sanitizeSheetName(name) {
    return (name || 'Grupo').replace(/[\\\/\?\*\[\]\:]/g, '_') || 'Grupo'
}

function timestamp() {
    const d = new Date()
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

module.exports = { initWhatsApp, scrapeGroups }
