import { useState, useEffect, useRef, useCallback } from 'react'

const BACKEND_WS = import.meta.env.VITE_BACKEND_WS || 'wss://scrapwhats-backend.onrender.com'
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://scrapwhats-backend.onrender.com'

const PROTOCOLS = [
  {
    id: 'randomDelays',
    name: 'Delays aleatórios',
    desc: 'Intervalo variável de 800ms a 3.2s entre consultas — imita comportamento humano',
    weight: 25,
    defaultOn: true,
  },
  {
    id: 'longPauses',
    name: 'Pausas longas periódicas',
    desc: 'Pausa de 15–30s a cada 10 grupos processados — simula interrupções naturais',
    weight: 20,
    defaultOn: true,
  },
  {
    id: 'randomOrder',
    name: 'Ordem aleatória dos grupos',
    desc: 'Processa grupos em ordem aleatória — evita padrões sequenciais detectáveis',
    weight: 10,
    defaultOn: true,
  },
  {
    id: 'useCache',
    name: 'Cache local de contatos',
    desc: 'Reutiliza nomes já consultados — elimina requisições duplicadas entre execuções',
    weight: 20,
    defaultOn: true,
  },
  {
    id: 'skipNameLookup',
    name: 'Pular busca de nomes',
    desc: 'Extrai só números sem consultar a API — reduz ~90% das requisições geradas',
    weight: 30,
    defaultOn: false,
  },
  {
    id: 'incrementalMode',
    name: 'Modo incremental (5 grupos/execução)',
    desc: 'Distribui a varredura ao longo do tempo — nunca processa tudo de uma vez',
    weight: 15,
    defaultOn: false,
  },
]

const MAX_RISK = PROTOCOLS.reduce((s, p) => s + p.weight, 0) // 120
const MIN_SHOW_MS = 5000

function buildDefaultCfg() {
  const cfg = {}
  PROTOCOLS.forEach(p => { cfg[p.id] = p.defaultOn })
  return cfg
}

function riskScore(cfg) {
  return PROTOCOLS.reduce((s, p) => s + (cfg[p.id] ? 0 : p.weight), 0)
}

function riskInfo(pct) {
  if (pct <= 12) return { label: 'MUITO BAIXO', color: '#10B981' }
  if (pct <= 33) return { label: 'BAIXO',       color: '#10B981' }
  if (pct <= 55) return { label: 'MÉDIO',        color: '#f59e0b' }
  if (pct <= 75) return { label: 'ALTO',         color: '#f97316' }
  return            { label: 'CRÍTICO',       color: '#ef4444' }
}

function tagStyle(w) {
  if (w >= 25) return { background: 'rgba(239,68,68,.15)', color: '#ef4444' }
  if (w >= 15) return { background: 'rgba(245,158,11,.15)', color: '#f59e0b' }
  return { background: 'rgba(16,185,129,.15)', color: '#10B981' }
}

function tagLabel(w) {
  if (w >= 25) return `🔴 ALTO IMPACTO (+${w})`
  if (w >= 15) return `🟡 MÉDIO IMPACTO (+${w})`
  return `🟢 BAIXO IMPACTO (+${w})`
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── SVG Icons ──────────────────────────────
const IconShare = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <circle cx="5.5" cy="12" r="3.5" fill="white"/>
    <circle cx="18.5" cy="5.5" r="2.5" fill="white" opacity=".85"/>
    <circle cx="18.5" cy="18.5" r="2.5" fill="white" opacity=".85"/>
    <line x1="8.5" y1="10.2" x2="16.2" y2="6.8" stroke="rgba(0,0,0,.6)" strokeWidth="1.8" strokeLinecap="round"/>
    <line x1="8.5" y1="13.8" x2="16.2" y2="17.2" stroke="rgba(0,0,0,.6)" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
)

const IconShield = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
)

const IconPhone = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="5" y="2" width="14" height="20" rx="2"/>
    <line x1="12" y1="18" x2="12" y2="18" strokeWidth="3"/>
  </svg>
)

const IconUsers = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
)

const IconActivity = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#00A8E8" strokeWidth="2">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
  </svg>
)

const IconArrowRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M5 12h14M12 5l7 7-7 7"/>
  </svg>
)

const IconArrowLeft = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M19 12H5M12 19l-7-7 7-7"/>
  </svg>
)

const IconPlay = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polygon points="5 3 19 12 5 21 5 3"/>
  </svg>
)

const IconDownload = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
)

const IconInsta = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
    <circle cx="12" cy="12" r="4"/>
    <circle cx="17.5" cy="6.5" r="1" fill="white" stroke="none"/>
  </svg>
)

const IconInstaSmall = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <rect x="2" y="2" width="20" height="20" rx="5"/>
    <circle cx="12" cy="12" r="4"/>
    <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/>
  </svg>
)

const IconQRPlaceholder = () => (
  <svg className="qr-box-icon" width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.5">
    <rect x="3" y="3" width="7" height="7" rx="1"/>
    <rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/>
    <rect x="5" y="5" width="3" height="3" fill="#475569" rx=".5"/>
    <rect x="16" y="5" width="3" height="3" fill="#475569" rx=".5"/>
    <rect x="5" y="16" width="3" height="3" fill="#475569" rx=".5"/>
    <circle cx="17" cy="17" r="1.5" fill="#475569"/>
    <circle cx="20" cy="14" r="1" fill="#475569"/>
    <circle cx="14" cy="20" r="1" fill="#475569"/>
    <circle cx="20" cy="20" r="1.5" fill="#475569"/>
  </svg>
)

// ── Subcomponents ──────────────────────────

function InstagramCTA() {
  return (
    <div className="insta-cta">
      <div className="insta-cta-inner">
        <div className="insta-logo">
          <IconInsta size={28} />
        </div>
        <div className="insta-text">
          <div className="insta-title">Se essa ferramenta foi útil para você</div>
          <div className="insta-sub">
            Siga a <strong>@iatize.ia</strong> no Instagram e fique por dentro de novidades, automações e soluções com IA
          </div>
        </div>
        <a
          className="btn insta-btn"
          href="https://www.instagram.com/iatize.ia/"
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconInstaSmall />
          Seguir @iatize.ia
        </a>
      </div>
    </div>
  )
}

// ── Main App ───────────────────────────────

export default function App() {
  // step: 'connect' | 'groups' | 'progress' | 'done'
  const [step, setStep] = useState('connect')
  const [cfg, setCfg] = useState(buildDefaultCfg())
  const [isMaster, setIsMaster] = useState(false)
  const [wsStatus, setWsStatus] = useState('') // '' | 'connecting' | 'connected'
  const [statusText, setStatusText] = useState('Desconectado')
  const [qrState, setQrState] = useState('idle') // 'idle' | 'spinner' | 'qr'
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [qrHint, setQrHint] = useState('Clique em Conectar para gerar o QR')
  const [showQrInstruct, setShowQrInstruct] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [allGroups, setAllGroups] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [groupFilter, setGroupFilter] = useState('')
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0, groupName: 'Iniciando...' })
  const [logs, setLogs] = useState([{ text: '[sistema] Iniciando varredura...', level: 'info' }])
  const [doneData, setDoneData] = useState(null)
  const [doneFilename, setDoneFilename] = useState('')
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [showDlModal, setShowDlModal] = useState(false)

  const wsRef = useRef(null)
  const scrapeStartRef = useRef(0)
  const logConsoleRef = useRef(null)

  // Sync master toggle state
  useEffect(() => {
    const allOn = PROTOCOLS.every(p => cfg[p.id])
    setIsMaster(allOn)
  }, [cfg])

  // Auto scroll logs
  useEffect(() => {
    if (logConsoleRef.current) {
      logConsoleRef.current.scrollTop = logConsoleRef.current.scrollHeight
    }
  }, [logs])

  const addLog = useCallback((text, level = 'info') => {
    const t = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setLogs(prev => [...prev, { text: `[${t}] ${text}`, level }])
  }, [])

  const handleWsMessage = useCallback((msg) => {
    switch (msg.type) {
      case 'qr':
        setQrState('qr')
        setQrDataUrl(msg.qr)
        setShowQrInstruct(true)
        setWsStatus('connecting')
        setStatusText('Aguardando leitura...')
        break
      case 'authenticated':
        setQrState('spinner')
        setQrHint('Autenticado! Carregando grupos...')
        setWsStatus('connecting')
        setStatusText('Autenticado...')
        break
      case 'ready':
        setWsStatus('connected')
        setStatusText('Conectado')
        break
      case 'groups':
        setAllGroups(msg.groups)
        setStep('groups')
        break
      case 'scraping_start':
        scrapeStartRef.current = Date.now()
        setProgress(prev => ({ ...prev, total: msg.total, current: 0, percent: 0, groupName: 'Iniciando...' }))
        setStep('progress')
        break
      case 'progress':
        setProgress({
          current: msg.current,
          total: msg.total,
          percent: msg.percent,
          groupName: msg.groupName,
        })
        break
      case 'log':
        addLog(msg.message, msg.level)
        break
      case 'done':
        handleDone(msg)
        break
      case 'error':
        addLog('ERRO: ' + msg.message, 'error')
        alert('Erro: ' + msg.message)
        break
      default:
        break
    }
  }, [addLog])

  const handleDone = useCallback((data) => {
    setDoneFilename(data.filename)
    setDoneData({ contacts: data.totalContacts || 0, groups: data.totalGroups || 0 })
    const elapsed = Date.now() - scrapeStartRef.current
    const remaining = Math.max(0, MIN_SHOW_MS - elapsed)
    setTimeout(() => {
      setStep('done')
    }, remaining)
  }, [])

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return
    setConnecting(true)
    setQrState('spinner')
    setQrHint('Aguardando QR Code...')

    const socket = new WebSocket(BACKEND_WS)
    wsRef.current = socket

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'init' }))
      setWsStatus('connecting')
      setStatusText('Aguardando QR...')
      // Client-side keepalive: send ping every 15s
      const keepalive = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }))
        } else {
          clearInterval(keepalive)
        }
      }, 15000)
      socket._keepalive = keepalive
    }

    socket.onmessage = (e) => {
      try { handleWsMessage(JSON.parse(e.data)) } catch {}
    }

    socket.onerror = () => {
      setWsStatus('')
      setStatusText('Erro de conexão')
      setConnecting(false)
      setQrState('idle')
      setQrHint('Falha na conexão com o servidor. Tente novamente.')
    }

    socket.onclose = (e) => {
      if (socket._keepalive) clearInterval(socket._keepalive)
      setConnecting(false)
      // Only show error if we haven't moved past connect step
      if (e.code !== 1000) {
        setWsStatus('')
        setStatusText('Conexão encerrada')
        setQrState('idle')
        setQrHint('Conexão perdida. Clique em Conectar novamente.')
      }
    }
  }, [handleWsMessage])

  const toggleProto = (id) => {
    setCfg(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const toggleMaster = () => {
    const next = !isMaster
    setIsMaster(next)
    const newCfg = {}
    PROTOCOLS.forEach(p => { newCfg[p.id] = next })
    setCfg(newCfg)
  }

  const toggleGroup = (groupId) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const selectAll = () => {
    setSelected(new Set(allGroups.map(g => g.id)))
  }

  const deselectAll = () => {
    setSelected(new Set())
  }

  const openConfirm = () => setShowConfirmModal(true)
  const closeConfirm = () => setShowConfirmModal(false)

  const startScrape = () => {
    closeConfirm()
    setLogs([{ text: '[sistema] Iniciando varredura...', level: 'info' }])
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'scrape',
        selectedGroups: Array.from(selected),
        config: { ...cfg },
      }))
    }
  }

  const downloadFile = () => setShowDlModal(true)
  const closeDlModal = () => setShowDlModal(false)

  const confirmDownload = () => {
    closeDlModal()
    if (doneFilename) {
      window.location.href = `${BACKEND_URL}/download/${doneFilename}`
    }
  }

  const goBack = () => setStep('connect')

  // ── Computed ──
  const score = riskScore(cfg)
  const riskPct = Math.round((score / MAX_RISK) * 100)
  const riskInf = riskInfo(riskPct)

  const filteredGroups = groupFilter
    ? allGroups.filter(g => g.name.toLowerCase().includes(groupFilter.toLowerCase()))
    : allGroups

  // ── Confirm modal content ──
  const getConfirmContent = () => {
    const active   = PROTOCOLS.filter(p => cfg[p.id])
    const inactive = PROTOCOLS.filter(p => !cfg[p.id])

    let iconType, icon, title, desc, btnCls, btnTxt
    if (riskPct <= 33) {
      iconType = 'ok'; icon = '✅'; title = 'Confirmar Varredura'
      desc = `Tudo configurado! Nível de risco ${riskInf.label}. Os protocolos ativos protegem bem o seu número.`
      btnCls = 'btn-success'; btnTxt = 'Confirmar e Iniciar'
    } else if (riskPct <= 55) {
      iconType = 'warn'; icon = '🔒'; title = 'Atenção — Risco Médio'
      desc = `Alguns protocolos estão desativados. Risco ${riskInf.label}. Recomendamos ativar mais proteções antes de continuar.`
      btnCls = 'btn-primary'; btnTxt = 'Entendido, Iniciar'
    } else {
      iconType = 'crit'; icon = '⚠️'; title = 'Risco Alto Detectado!'
      desc = `Muitos protocolos estão desativados. Risco ${riskInf.label}. Há chance considerável de bloqueio do número. Você assume integralmente a responsabilidade.`
      btnCls = 'btn-danger'; btnTxt = '⚠️ Assumo o Risco, Iniciar'
    }

    return { iconType, icon, title, desc, btnCls, btnTxt, active, inactive }
  }

  const confirmContent = getConfirmContent()

  // ── Step indicators ──
  const step1State = step === 'connect' ? 'active' : 'done'
  const step2State = step === 'groups' ? 'active' : (step === 'progress' || step === 'done') ? 'done' : ''
  const step3State = step === 'progress' ? 'active' : step === 'done' ? 'done' : ''

  return (
    <>
      {/* Header */}
      <header className="header">
        <div className="logo-icon">
          <IconShare />
        </div>
        <div>
          <div className="logo-name">iatize</div>
          <div className="logo-product">ScrapWhats</div>
        </div>
        <div className="header-right">
          <div className={`status-pill ${wsStatus}`}>
            <div className="status-dot"></div>
            <span>{statusText}</span>
          </div>
        </div>
      </header>

      <main className="main">
        {/* Steps */}
        <div className="steps">
          <div className={`step ${step1State}`}>
            <div className="step-num">{step1State === 'done' ? '✓' : '1'}</div>
            <span className="step-lbl">Conectar</span>
          </div>
          <div className="step-line"></div>
          <div className={`step ${step2State}`}>
            <div className="step-num">{step2State === 'done' ? '✓' : '2'}</div>
            <span className="step-lbl">Grupos</span>
          </div>
          <div className="step-line"></div>
          <div className={`step ${step3State}`}>
            <div className="step-num">{step3State === 'done' ? '✓' : '3'}</div>
            <span className="step-lbl">Extrair</span>
          </div>
        </div>

        {/* ═══ STEP 1: Connect ═══ */}
        {step === 'connect' && (
          <div>
            {/* Security Card */}
            <div className="card">
              <div className="card-head">
                <div className="card-title">
                  <IconShield />
                  Protocolos de Segurança
                </div>
                <div className="card-sub">Escolha o nível de proteção para o seu número antes de conectar</div>
              </div>

              {/* Risk Meter */}
              <div className="risk-meter">
                <div className="risk-meter-top">
                  <span className="risk-meter-label">Nível de Risco</span>
                  <span
                    className="risk-badge"
                    style={{ background: riskInf.color + '22', color: riskInf.color }}
                  >
                    {riskInf.label}
                  </span>
                </div>
                <div className="risk-track">
                  <div
                    className="risk-fill"
                    style={{
                      width: riskPct + '%',
                      background: `linear-gradient(90deg, ${riskInf.color}88, ${riskInf.color})`,
                    }}
                  ></div>
                </div>
              </div>

              {/* Master Toggle */}
              <div className="master-toggle" onClick={toggleMaster}>
                <div className="master-info">
                  <h3>🛡️ Segurança Máxima</h3>
                  <p>Ativa todos os protocolos simultaneamente</p>
                </div>
                <div className={`sw ${isMaster ? 'on' : ''}`}></div>
              </div>

              {/* Protocol Items */}
              <div className="proto-list">
                {PROTOCOLS.map(p => (
                  <div
                    key={p.id}
                    className={`proto-item ${cfg[p.id] ? 'on' : ''}`}
                    onClick={() => toggleProto(p.id)}
                  >
                    <div className={`sw ${cfg[p.id] ? 'on' : ''}`}></div>
                    <div className="proto-body">
                      <div className="proto-name">{p.name}</div>
                      <div className="proto-desc">{p.desc}</div>
                      <span className="proto-tag" style={tagStyle(p.weight)}>{tagLabel(p.weight)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* QR Connect Card */}
            <div className="card">
              <div className="card-head">
                <div className="card-title">
                  <IconPhone />
                  Conectar ao WhatsApp
                </div>
                <div className="card-sub">Escaneie o QR Code com o celular para autenticar</div>
              </div>

              <div className="qr-wrapper">
                {/* QR Box */}
                {qrState === 'idle' && (
                  <div className="qr-box">
                    <IconQRPlaceholder />
                    <div className="qr-box-hint">{qrHint}</div>
                  </div>
                )}
                {qrState === 'spinner' && (
                  <div className="qr-box">
                    <div className="spinner"></div>
                    <div className="qr-box-hint">{qrHint}</div>
                  </div>
                )}
                {qrState === 'qr' && (
                  <div className="qr-box has-qr">
                    <img src={qrDataUrl} alt="QR Code" />
                  </div>
                )}

                {showQrInstruct && (
                  <div className="qr-instruction">
                    📱 <strong>WhatsApp</strong> → Configurações → Aparelhos conectados → Conectar um aparelho
                  </div>
                )}

                <button
                  className="btn btn-primary btn-lg"
                  onClick={connect}
                  disabled={connecting}
                >
                  {connecting ? (
                    <>
                      <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }}></div>
                      Conectando...
                    </>
                  ) : (
                    <>
                      <IconArrowRight />
                      Conectar
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Risk Warning Banner */}
            <div className="risk-banner">
              <div className="risk-banner-title">⚠️ Leia antes de usar</div>
              <ul>
                <li>Esta ferramenta usa automação não-oficial do WhatsApp Web e pode violar os Termos de Serviço do WhatsApp.</li>
                <li>Existe risco real de bloqueio temporário ou permanente do número utilizado. <strong>Use sempre um número secundário.</strong></li>
                <li>Os protocolos de segurança reduzem, mas não eliminam o risco de detecção.</li>
                <li>Você é o único responsável pelo uso desta ferramenta e suas consequências legais.</li>
              </ul>
            </div>
          </div>
        )}

        {/* ═══ STEP 2: Groups ═══ */}
        {step === 'groups' && (
          <div>
            <div className="card">
              <div className="card-head">
                <div className="card-title">
                  <IconUsers />
                  Grupos do WhatsApp
                </div>
                <div className="card-sub">Selecione quais grupos deseja varrer</div>
              </div>

              <input
                className="group-search"
                type="text"
                placeholder="🔍  Buscar grupo pelo nome..."
                value={groupFilter}
                onChange={e => setGroupFilter(e.target.value)}
              />

              <div className="group-controls">
                <span className="group-controls-count">
                  {filteredGroups.length} grupo{filteredGroups.length !== 1 ? 's' : ''} encontrado{filteredGroups.length !== 1 ? 's' : ''}
                </span>
                <div className="group-controls-btns">
                  <button className="btn btn-ghost btn-sm" onClick={selectAll}>Todos</button>
                  <button className="btn btn-ghost btn-sm" onClick={deselectAll}>Limpar</button>
                </div>
              </div>

              <div className="group-scroll">
                {filteredGroups.map(g => (
                  <div
                    key={g.id}
                    className={`group-item ${selected.has(g.id) ? 'sel' : ''}`}
                    onClick={() => toggleGroup(g.id)}
                  >
                    <div className="g-check">{selected.has(g.id) ? '✓' : ''}</div>
                    <div className="g-name">{g.name}</div>
                    <div className="g-count">{g.members} membros</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="action-bar">
              <button className="btn btn-ghost" onClick={goBack}>
                <IconArrowLeft />
                Voltar e ajustar segurança
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span className="sel-count">
                  {selected.size} grupo{selected.size !== 1 ? 's' : ''} selecionado{selected.size !== 1 ? 's' : ''}
                </span>
                <button
                  className="btn btn-success btn-lg"
                  onClick={openConfirm}
                  disabled={selected.size === 0}
                >
                  <IconPlay />
                  Iniciar Varredura
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ STEP 3: Progress ═══ */}
        {step === 'progress' && (
          <div>
            <div className="card">
              <div className="card-head">
                <div className="card-title">
                  <IconActivity />
                  Varredura em Andamento
                </div>
                <div className="card-sub">Processando: {progress.groupName}</div>
              </div>

              <div className="prog-track">
                <div className="prog-fill" style={{ width: progress.percent + '%' }}></div>
              </div>
              <div className="prog-stats">
                <span>{progress.current} / {progress.total} grupos</span>
                <span>{progress.percent}%</span>
              </div>

              {/* Instagram CTA above the log */}
              <div style={{ marginBottom: 16 }}>
                <InstagramCTA />
              </div>

              <div className="log-console" ref={logConsoleRef}>
                {logs.map((l, i) => (
                  <div key={i} className={`log-line ${l.level}`}>{l.text}</div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ STEP 4: Done ═══ */}
        {step === 'done' && (
          <div>
            <div className="card done-wrap">
              <div className="done-ring">✓</div>
              <div className="done-title">Extração Concluída!</div>
              <div className="done-sub">Todos os contatos foram extraídos com sucesso</div>

              <div className="done-stats">
                <div className="done-stat">
                  <div className="done-stat-val">{(doneData?.contacts || 0).toLocaleString('pt-BR')}</div>
                  <div className="done-stat-lbl">Contatos</div>
                </div>
                <div className="done-stat">
                  <div className="done-stat-val">{doneData?.groups || 0}</div>
                  <div className="done-stat-lbl">Grupos</div>
                </div>
              </div>

              <div className="done-btns">
                <button className="btn btn-primary btn-lg" onClick={downloadFile}>
                  <IconDownload />
                  Baixar Excel
                </button>
                <button className="btn btn-ghost btn-lg" onClick={() => window.location.reload()}>
                  Nova Varredura
                </button>
              </div>
            </div>

            <InstagramCTA />
          </div>
        )}
      </main>

      {/* ═══ Download CTA Modal ═══ */}
      {showDlModal && (
        <div className="overlay show" onClick={e => { if (e.target === e.currentTarget) closeDlModal() }}>
          <div className="modal" style={{ textAlign: 'center' }}>
            <div className="dl-modal-ig-icon">
              <IconInsta size={32} />
            </div>
            <div className="modal-title">Que bom que foi útil! 🎉</div>
            <div className="modal-desc">
              A <strong>iatize</strong> cria ferramentas como essa gratuitamente. Se te ajudou, considere seguir o perfil no Instagram — ajuda muito a manter o projeto ativo!
            </div>
            <a
              className="btn insta-btn"
              href="https://www.instagram.com/iatize.ia/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ width: '100%', justifyContent: 'center', marginBottom: 12, fontSize: 15, padding: '13px 20px' }}
            >
              <IconInstaSmall />
              Seguir @iatize.ia no Instagram
            </a>
            <button
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={confirmDownload}
            >
              Já sigo — baixar arquivo
            </button>
          </div>
        </div>
      )}

      {/* ═══ Confirm Modal ═══ */}
      {showConfirmModal && (
        <div className="overlay show" onClick={e => { if (e.target === e.currentTarget) closeConfirm() }}>
          <div className="modal">
            <div className={`modal-icon ${confirmContent.iconType}`}>
              {confirmContent.icon}
            </div>
            <div className="modal-title">{confirmContent.title}</div>
            <div className="modal-desc">{confirmContent.desc}</div>
            <div className="modal-summary">
              <p><span style={{ color: '#00A8E8' }}>◈</span> <strong>{selected.size}</strong> grupo{selected.size !== 1 ? 's' : ''} selecionado{selected.size !== 1 ? 's' : ''}</p>
              {confirmContent.active.length > 0 && (
                <p><span style={{ color: '#10B981' }}>✓</span> {confirmContent.active.length} protocolo{confirmContent.active.length !== 1 ? 's' : ''} de segurança ativo{confirmContent.active.length !== 1 ? 's' : ''}</p>
              )}
              {confirmContent.inactive.length > 0 && (
                <p><span style={{ color: '#ef4444' }}>✗</span> {confirmContent.inactive.length} protocolo{confirmContent.inactive.length !== 1 ? 's' : ''} desativado{confirmContent.inactive.length !== 1 ? 's' : ''}</p>
              )}
              <p><span style={{ color: riskInf.color }}>◈</span> Nível de risco: <strong style={{ color: riskInf.color }}>{riskInf.label}</strong></p>
            </div>
            <div className="modal-disclaimer">
              Ao continuar, você confirma que leu os avisos de risco, entende as implicações desta operação e assume total responsabilidade pelo uso desta ferramenta.
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={closeConfirm}>Cancelar</button>
              <button className={`btn ${confirmContent.btnCls}`} onClick={startScrape}>
                {confirmContent.btnTxt}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
