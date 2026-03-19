const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const XLSX = require('xlsx');
const readline = require('readline');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './session' }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('\n📱 Escaneie o QR Code abaixo com o WhatsApp:\n');
    qrcode.generate(qr, { small: true });
    console.log('\n(WhatsApp > Configurações > Aparelhos conectados > Conectar um aparelho)\n');
});

client.on('authenticated', () => {
    console.log('✅ Autenticado!');
});

client.on('auth_failure', (msg) => {
    console.error('❌ Falha na autenticação:', msg);
    process.exit(1);
});

client.on('ready', async () => {
    console.log('✅ Conectado ao WhatsApp!\n');

    try {
        const chats = await client.getChats();
        const groups = chats.filter(chat => chat.isGroup);

        if (groups.length === 0) {
            console.log('Nenhum grupo encontrado.');
            process.exit(0);
        }

        // Exibe lista de grupos
        console.log(`📋 Seus grupos (${groups.length} encontrados):\n`);
        groups.forEach((g, i) => {
            const total = g.groupMetadata?.participants?.length || 0;
            console.log(`  [${String(i + 1).padStart(2, '0')}] ${g.name} (${total} membros)`);
        });

        console.log('\n  [0 ] Todos os grupos\n');

        // Pergunta ao usuário
        const escolha = await perguntar('Digite o número do grupo (ou 0 para todos): ');
        const num = parseInt(escolha.trim());

        let gruposSelecionados;
        if (num === 0) {
            gruposSelecionados = groups;
            console.log(`\n✅ Selecionado: todos os ${groups.length} grupos\n`);
        } else if (num >= 1 && num <= groups.length) {
            gruposSelecionados = [groups[num - 1]];
            console.log(`\n✅ Selecionado: "${groups[num - 1].name}"\n`);
        } else {
            console.log('❌ Opção inválida.');
            process.exit(1);
        }

        await varrerGrupos(gruposSelecionados);

    } catch (err) {
        console.error('❌ Erro:', err.message);
        process.exit(1);
    }
});

async function varrerGrupos(grupos) {
    const wb = XLSX.utils.book_new();

    for (let i = 0; i < grupos.length; i++) {
        const group = grupos[i];
        console.log(`[${i + 1}/${grupos.length}] Varrendo: ${group.name}`);

        const participants = group.groupMetadata?.participants || [];
        const rows = [];

        for (const participant of participants) {
            const number = participant.id.user;
            const fullId = participant.id._serialized;

            let nome = '';
            try {
                const contact = await client.getContactById(fullId);
                // Prioridade: nome salvo na agenda > nome de exibição do WhatsApp
                nome = contact.name || contact.pushname || '';
            } catch {
                nome = '';
            }

            rows.push({ Telefone: number, Nome: nome });
        }

        console.log(`   → ${rows.length} contatos extraídos`);

        // Nome da aba: máx 31 chars (limite do Excel), sem caracteres inválidos
        const abaName = sanitizeSheetName(group.name).substring(0, 31);
        const ws = XLSX.utils.json_to_sheet(rows, { header: ['Telefone', 'Nome'] });
        ws['!cols'] = [{ wch: 20 }, { wch: 35 }];
        XLSX.utils.book_append_sheet(wb, ws, abaName);

        await sleep(400);
    }

    const filename = `contatos_whatsapp_${timestamp()}.xlsx`;
    XLSX.writeFile(wb, filename);

    console.log(`\n✅ Concluído!`);
    console.log(`📊 Arquivo salvo: ${filename}`);
    console.log(`   ${grupos.length} aba(s) gerada(s)\n`);

    process.exit(0);
}

// Remove caracteres inválidos para nome de aba do Excel: \ / ? * [ ] :
function sanitizeSheetName(name) {
    return name.replace(/[\\\/\?\*\[\]\:]/g, '_') || 'Grupo';
}

function perguntar(prompt) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(prompt, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

function timestamp() {
    const d = new Date();
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function pad(n) { return String(n).padStart(2, '0'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

console.log('🚀 Iniciando ScrapWhats...\n');
client.initialize();
