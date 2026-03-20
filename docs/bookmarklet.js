(function () {
  'use strict';

  if (!location.href.includes('web.whatsapp.com')) {
    alert('❌ Execute este bookmarklet no WhatsApp Web\n\nVá para https://web.whatsapp.com primeiro, faça login e clique novamente.');
    return;
  }

  const existing = document.getElementById('scrapwhats-panel');
  if (existing) { existing.style.display = 'flex'; return; }

  buildPanel();

  if (window.XLSX) {
    init();
  } else {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = init;
    s.onerror = () => setStatus('❌ Falha ao carregar XLSX. Verifique sua conexão.', 'error');
    document.head.appendChild(s);
  }

  /* ── UI ──────────────────────────────────────────────────────── */

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'scrapwhats-panel';
    panel.style.cssText = [
      'position:fixed;top:20px;right:20px;z-index:2147483647',
      'width:380px;max-height:90vh',
      'background:rgba(11,18,32,0.97)',
      'backdrop-filter:blur(20px)',
      'border:1px solid rgba(0,168,232,0.35)',
      'border-radius:18px;padding:22px 24px',
      'color:#fff;font-family:Inter,system-ui,sans-serif',
      'box-shadow:0 12px 40px rgba(0,0,0,0.5)',
      'display:flex;flex-direction:column;gap:0',
    ].join(';');

    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">
        <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#00A8E8,#0077cc);display:flex;align-items:center;justify-content:center;font-size:18px">⚡</div>
        <div>
          <div style="font-weight:700;font-size:15px;color:#00A8E8">ScrapWhats</div>
          <div style="font-size:11px;color:#555">by iatize CRM</div>
        </div>
        <button id="sw-close" style="margin-left:auto;background:none;border:none;color:#555;cursor:pointer;font-size:20px;line-height:1;padding:4px">✕</button>
      </div>
      <div id="sw-body">
        <div id="sw-status" style="color:#aaa;font-size:13px;padding:12px 0">Carregando...</div>
      </div>
    `;

    document.body.appendChild(panel);
    document.getElementById('sw-close').onclick = () => panel.remove();
  }

  function setStatus(msg, type) {
    const el = document.getElementById('sw-status');
    if (!el) return;
    const color = type === 'error' ? '#ff6b6b' : type === 'success' ? '#4ade80' : '#aaa';
    el.innerHTML = `<span style="color:${color}">${msg}</span>`;
  }

  function setBody(html) {
    const el = document.getElementById('sw-body');
    if (el) el.innerHTML = html;
  }

  /* ── WhatsApp Web internals ──────────────────────────────────── */

  async function getWARequire() {
    return new Promise((resolve, reject) => {
      const chunk = window.webpackChunkwhatsapp_web_client;
      if (!chunk) { reject(new Error('WhatsApp Web não carregado. Aguarde o carregamento completo e tente novamente.')); return; }
      let done = false;
      chunk.push([
        ['sw_' + Math.random().toString(36).slice(2)], {},
        (r) => { if (!done) { done = true; resolve(r); } }
      ]);
      setTimeout(() => { if (!done) reject(new Error('Timeout ao acessar módulos do WhatsApp Web.')); }, 8000);
    });
  }

  async function findStore(req, test) {
    const ids = Object.keys(req.m);
    for (const id of ids) {
      try {
        const m = req(id);
        for (const exp of [m, m && m.default]) {
          if (exp && typeof exp.getModelsArray === 'function') {
            const arr = exp.getModelsArray();
            if (arr.length > 0 && test(arr[0])) return exp;
          }
        }
      } catch (_) {}
    }
    return null;
  }

  function isChatModel(m) { return 'isGroup' in m && 'id' in m; }
  function isContactModel(m) { return 'pushname' in m && 'isMyContact' in m; }

  /* ── Main flow ───────────────────────────────────────────────── */

  async function init() {
    setStatus('Conectando ao WhatsApp Web...');
    let req;
    try { req = await getWARequire(); }
    catch (e) { setStatus('❌ ' + e.message, 'error'); return; }

    setStatus('Buscando grupos...');
    const chatStore = await findStore(req, isChatModel);
    const contactStore = await findStore(req, isContactModel);

    if (!chatStore) {
      setStatus('❌ Não foi possível acessar os grupos.<br>Certifique-se que o WhatsApp Web está totalmente carregado (aguarde a lista de conversas aparecer).', 'error');
      return;
    }

    const groups = chatStore.getModelsArray().filter(c => c.isGroup);
    if (groups.length === 0) {
      setStatus('❌ Nenhum grupo encontrado.', 'error');
      return;
    }

    window._sw = { groups, contactStore };
    renderGroupList(groups);
  }

  /* ── Group selector UI ───────────────────────────────────────── */

  function renderGroupList(groups) {
    setBody(`
      <div style="font-size:12px;color:#666;margin-bottom:10px">${groups.length} grupos encontrados</div>

      <div style="display:flex;gap:6px;margin-bottom:10px">
        <button onclick="document.querySelectorAll('#sw-cbs input').forEach(c=>c.checked=true)"
          style="flex:1;padding:6px 10px;background:rgba(0,168,232,0.12);border:1px solid rgba(0,168,232,0.3);color:#00A8E8;border-radius:8px;cursor:pointer;font-size:12px">
          Selecionar todos
        </button>
        <button onclick="document.querySelectorAll('#sw-cbs input').forEach(c=>c.checked=false)"
          style="flex:1;padding:6px 10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:#777;border-radius:8px;cursor:pointer;font-size:12px">
          Limpar
        </button>
      </div>

      <div id="sw-cbs" style="max-height:260px;overflow-y:auto;border:1px solid rgba(255,255,255,0.06);border-radius:10px;margin-bottom:14px">
        ${groups.map((g, i) => `
          <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.04)"
            onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background='none'">
            <input type="checkbox" value="${i}" checked style="accent-color:#00A8E8;width:15px;height:15px;cursor:pointer">
            <div>
              <div style="font-size:13px;color:#fff">${esc(g.name || 'Grupo sem nome')}</div>
              <div style="font-size:11px;color:#555">${g.groupMetadata?.participants?.length || '?'} membros</div>
            </div>
          </label>
        `).join('')}
      </div>

      <button id="sw-extract-btn" onclick="swExtract()"
        style="width:100%;padding:13px;background:linear-gradient(135deg,#00A8E8,#0077cc);border:none;border-radius:10px;color:#fff;font-weight:600;cursor:pointer;font-size:14px;letter-spacing:.3px">
        ⬇ Extrair Contatos
      </button>

      <div id="sw-prog" style="margin-top:12px;font-size:12px;color:#aaa;display:none;text-align:center"></div>
    `);
  }

  /* ── Extraction ──────────────────────────────────────────────── */

  window.swExtract = async function () {
    const btn = document.getElementById('sw-extract-btn');
    const prog = document.getElementById('sw-prog');
    const checked = [...document.querySelectorAll('#sw-cbs input:checked')];

    if (!checked.length) { alert('Selecione ao menos um grupo.'); return; }

    btn.disabled = true;
    btn.textContent = 'Extraindo...';
    prog.style.display = 'block';

    const { groups, contactStore } = window._sw;
    const wb = window.XLSX.utils.book_new();
    let total = 0;

    for (let i = 0; i < checked.length; i++) {
      const group = groups[parseInt(checked[i].value)];
      const name = group.name || 'Grupo';
      prog.textContent = `[${i + 1}/${checked.length}] ${name}`;

      const rawParticipants =
        group.groupMetadata?.participants?.getModelsArray?.() ||
        group.groupMetadata?.participants ||
        [];

      const rows = rawParticipants.map(p => {
        const jid = p.id?._serialized || '';
        const phone = p.id?.user || jid.split('@')[0] || '';
        let nome = '', status = 'Sem Nome';

        if (contactStore) {
          const c = contactStore.get ? contactStore.get(jid) : null;
          if (c?.name)     { nome = c.name;     status = 'Salvo na Agenda'; }
          else if (c?.pushname) { nome = c.pushname; status = 'Nome do WhatsApp'; }
        }
        if (!nome && p.name)     { nome = p.name;     status = 'Nome do WhatsApp'; }
        if (!nome && p.pushname) { nome = p.pushname; status = 'Nome do WhatsApp'; }

        return { Telefone: phone, Nome: nome, 'Status do Nome': status };
      });

      total += rows.length;
      const sheetName = name.replace(/[\\/?*[\]:]/g, '_').substring(0, 31) || 'Grupo';
      const ws = window.XLSX.utils.json_to_sheet(rows, { header: ['Telefone', 'Nome', 'Status do Nome'] });
      ws['!cols'] = [{ wch: 20 }, { wch: 35 }, { wch: 20 }];
      window.XLSX.utils.book_append_sheet(wb, ws, sheetName);

      await new Promise(r => setTimeout(r, 80));
    }

    const fname = `contatos_${ts()}.xlsx`;
    window.XLSX.writeFile(wb, fname);

    prog.innerHTML = `<span style="color:#4ade80">✅ ${total} contatos extraídos de ${checked.length} grupo(s)!</span>
      <br><span style="color:#555">Siga <a href="https://www.instagram.com/iatize.ia/" target="_blank" style="color:#00A8E8">@iatize.ia</a> para mais ferramentas</span>`;
    btn.disabled = false;
    btn.textContent = '⬇ Extrair Novamente';
  };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function ts() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  }
})();
