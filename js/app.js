/* =========================================================
   APP.JS — Interfaz del dashboard
   ========================================================= */

let STATE = null;
let METODO_ACTUAL = 'recomendada'; // 'promedio' | 'regresion' | 'robusta' | 'recomendada'
let FILTRO_SUCURSAL = 'todas';

const METODOS = [
  { key: 'promedio', label: 'Promedio simple' },
  { key: 'regresion', label: 'Regresión lineal' },
  { key: 'robusta', label: 'Robusta (sin atípicos)' },
  { key: 'recomendada', label: 'Recomendada (combinada)' },
];

async function init() {
  STATE = await DataEngine.loadAll();
  renderMethodPills();
  renderSucursalChips();
  renderAll();
  document.getElementById('loading-screen').classList.add('done');
  wireChat();
}

function renderAll() {
  renderKPIs();
  renderAlerts();
  renderOrdersTable();
  renderProviders();
  renderAnomalies();
}

/* ---------------- KPIs ---------------- */

function renderKPIs() {
  const filas = DataEngine.todasLasFilas(STATE, METODO_ACTUAL);
  const olvidos = DataEngine.alertasOlvido(STATE);
  const crit = filas.filter(f => f.status === 'crit').length;
  const warn = filas.filter(f => f.status === 'warn').length;
  const unknown = filas.filter(f => f.status === 'unknown').length;
  const ok = filas.filter(f => f.status === 'ok').length;

  const kpis = [
    { n: crit, label: 'Riesgo de quiebre', cls: 'crit' },
    { n: warn, label: 'Sobre-pedido', cls: 'warn' },
    { n: olvidos.length, label: 'Ingredientes olvidados', cls: 'crit' },
    { n: unknown, label: 'No catalogados', cls: 'unknown' },
    { n: ok, label: 'Órdenes correctas', cls: 'ok' },
  ];

  document.getElementById('kpi-row').innerHTML = kpis.map((k, i) => `
    <div class="kpi-card ${k.cls}" style="animation-delay:${i * 0.05}s">
      <div class="kpi-num">${k.n}</div>
      <span class="kpi-label">${k.label}</span>
    </div>
  `).join('');
}

/* ---------------- Método de proyección (pills) ---------------- */

function renderMethodPills() {
  document.getElementById('method-pills').innerHTML = METODOS.map(m => `
    <button class="method-pill ${m.key === METODO_ACTUAL ? 'selected' : ''}" data-method="${m.key}">
      ${m.label}
    </button>
  `).join('');
  document.querySelectorAll('.method-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      METODO_ACTUAL = btn.dataset.method;
      renderMethodPills();
      renderAll();
    });
  });
}

function renderSucursalChips() {
  const chips = ['todas', ...STATE.sucursales];
  document.getElementById('sucursal-chips').innerHTML = chips.map(s => `
    <button class="chip ${s === FILTRO_SUCURSAL ? 'active' : ''}" data-suc="${s}">
      ${s === 'todas' ? 'Todas las sucursales' : s}
    </button>
  `).join('');
  document.querySelectorAll('.chip[data-suc]').forEach(btn => {
    btn.addEventListener('click', () => {
      FILTRO_SUCURSAL = btn.dataset.suc;
      renderSucursalChips();
      renderAll();
    });
  });
}

function filasFiltradas() {
  let filas = DataEngine.todasLasFilas(STATE, METODO_ACTUAL);
  if (FILTRO_SUCURSAL !== 'todas') filas = filas.filter(f => f.sucursal === FILTRO_SUCURSAL);
  return filas;
}

/* ---------------- Lista de alertas ---------------- */

function renderAlerts() {
  const filas = filasFiltradas().filter(f => f.status !== 'ok');
  const olvidos = DataEngine.alertasOlvido(STATE).filter(o => FILTRO_SUCURSAL === 'todas' || o.sucursal === FILTRO_SUCURSAL);

  const cards = [];

  filas.forEach(f => {
    if (f.status === 'crit') {
      cards.push({
        cls: 'crit', tag: 'RIESGO DE QUIEBRE',
        msg: `<b>${f.sucursal}</b> está pidiendo <b>${round1(f.pedidoBase)} ${f.unidad}</b> de <b>${f.nombre}</b>,
              pero se proyecta que necesitará <b>${round1(f.proyeccion)} ${f.unidad}</b> (ya tiene ${round1(f.stock)} en stock).
              Faltan aprox. <b>${round1(Math.abs(f.diferencia))} ${f.unidad}</b>.`,
        meta: `Proveedor: ${f.proveedor}`,
      });
    } else if (f.status === 'warn') {
      cards.push({
        cls: 'warn', tag: f.perecedero ? 'SOBRE-PEDIDO · PERECEDERO' : 'SOBRE-PEDIDO',
        msg: `<b>${f.sucursal}</b> está pidiendo <b>${round1(f.diferencia)} ${f.unidad}</b> más de <b>${f.nombre}</b>
              de lo que proyectamos que necesita.${f.perecedero ? ' Al ser perecedero, hay riesgo real de que se venza.' : ''}`,
        meta: `Proveedor: ${f.proveedor}`,
      });
    } else if (f.status === 'unknown') {
      cards.push({
        cls: 'unknown', tag: 'INGREDIENTE DESCONOCIDO',
        msg: `<b>${f.sucursal}</b> pidió <b>${f.pedido} unidades</b> de "<b>${f.ingId}</b>", un ingrediente que
              no existe en el catálogo. No se puede convertir a unidad base ni evaluar si la cantidad es correcta.`,
        meta: `Acción sugerida: verificar con la sucursal y actualizar el catálogo.`,
      });
    }
  });

  olvidos.forEach(o => {
    cards.push({
      cls: 'crit', tag: 'POSIBLE OLVIDO',
      msg: `<b>${o.sucursal}</b> normalmente consume <b>${round1(o.consumoPromedio)} unidades/semana</b> de
            <b>${o.nombre}</b>, pero esta semana <b>no aparece en su orden</b>.`,
      meta: `Proveedor: ${o.proveedor}`,
    });
  });

  const panelTitle = document.getElementById('alerts-count');
  panelTitle.textContent = cards.length;

  const list = document.getElementById('alert-list');
  if (!cards.length) {
    list.innerHTML = `<p class="text-muted" style="padding:1rem">No hay alertas para este filtro. Todo en orden ✅</p>`;
    return;
  }
  list.innerHTML = cards.map((c, i) => `
    <div class="alert-card ${c.cls}" style="animation-delay:${i * 0.02}s">
      <div class="alert-top"><span class="alert-tag">${c.tag}</span></div>
      <div class="alert-msg">${c.msg}</div>
      <div class="alert-meta">${c.meta}</div>
    </div>
  `).join('');
}

/* ---------------- Tabla editable de órdenes ---------------- */

function renderOrdersTable() {
  const filas = filasFiltradas().sort((a, b) => {
    const order = { crit: 0, unknown: 1, warn: 2, ok: 3 };
    return order[a.status] - order[b.status];
  });

  const tbody = document.getElementById('orders-tbody');
  tbody.innerHTML = filas.map(f => `
    <tr data-suc="${f.sucursal}" data-ing="${f.ingId}">
      <td><span class="status-dot ${f.status}"></span>${f.sucursal}</td>
      <td>${f.nombre}${f.perecedero ? ' <span class="perecedero-flag">● perecedero</span>' : ''}</td>
      <td>${f.proveedor || '—'}</td>
      <td>${round1(f.proyeccion)} ${f.unidad || ''}</td>
      <td>${round1(f.stock)} ${f.unidad || ''}</td>
      <td>${f.necesidad !== undefined ? round1(f.necesidad) + ' ' + (f.unidad || '') : '—'}</td>
      <td>
        <input type="number" min="0" class="qty-input" value="${f.pedido}"
          data-suc="${f.sucursal}" data-ing="${f.ingId}" ${!f.factor ? 'disabled' : ''} />
        <span class="text-muted" style="font-size:.65rem">${f.formato || ''}</span>
      </td>
      <td>${f.pedidoBase !== null && f.pedidoBase !== undefined ? round1(f.pedidoBase) + ' ' + (f.unidad || '') : '—'}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.qty-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const suc = e.target.dataset.suc;
      const ing = e.target.dataset.ing;
      const val = Number(e.target.value) || 0;
      STATE.ordenes[suc] = STATE.ordenes[suc] || {};
      STATE.ordenes[suc][ing] = val;
      renderAll(); // recalcula todo en vivo
    });
  });
}

/* ---------------- Pedido corregido por proveedor ---------------- */

function renderProviders() {
  const data = DataEngine.pedidoCorregidoPorProveedor(STATE, METODO_ACTUAL);
  const container = document.getElementById('providers-container');
  const proveedores = Object.keys(data).sort();

  if (!proveedores.length) {
    container.innerHTML = `<p class="text-muted">No hay necesidades de compra pendientes con los datos actuales.</p>`;
    return;
  }

  container.innerHTML = proveedores.map(prov => {
    const items = data[prov];
    const filas = Object.values(items).map(it => `
      <div class="provider-item">
        <span>${it.nombre} <span class="text-muted">(${it.formato})</span></span>
        <span><b>${it.total}</b> ${it.total === 1 ? 'unidad' : 'unidades'} de formato</span>
      </div>
    `).join('');
    return `
      <div class="provider-block">
        <div class="provider-head">${prov} <span>${Object.keys(items).length} ítem(s)</span></div>
        <div class="provider-items">${filas}</div>
      </div>
    `;
  }).join('');
}

/* ---------------- Anomalías entre sucursales ---------------- */

function renderAnomalies() {
  const anomalias = DataEngine.anomaliasEntreSucursales(STATE, METODO_ACTUAL)
    .filter(a => FILTRO_SUCURSAL === 'todas' || a.sucursal === FILTRO_SUCURSAL);
  const container = document.getElementById('anomalies-container');

  if (!anomalias.length) {
    container.innerHTML = `<p class="text-muted">No se detectaron patrones de pedido inusuales entre sucursales.</p>`;
    return;
  }

  container.innerHTML = anomalias.slice(0, 10).map(a => {
    const direccion = a.ratio > a.promedioResto ? 'más' : 'menos';
    return `
      <div class="anomaly-card">
        <b>${a.sucursal}</b> pide ${direccion} <b>${a.nombre}</b> en proporción a lo que proyectamos que necesita,
        comparado con el resto de las sucursales
        (ratio pedido/proyección: <b>${round2(a.ratio)}</b> vs. promedio del resto <b>${round2(a.promedioResto)}</b>).
      </div>
    `;
  }).join('');
}

/* ---------------- Chat con los datos ---------------- */

function wireChat() {
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const log = document.getElementById('chat-log');

  document.querySelectorAll('.chat-suggestions button').forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.textContent;
      form.dispatchEvent(new Event('submit'));
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    input.value = '';

    appendChatMsg(log, question, 'user');
    const loadingEl = appendChatMsg(log, 'Pensando…', 'bot loading');

    try {
      const contexto = DataEngine.resumenParaChat(STATE, METODO_ACTUAL);
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, contexto }),
      });
      const data = await res.json();
      loadingEl.classList.remove('loading');
      loadingEl.textContent = data.answer || 'No pude generar una respuesta. Intenta de nuevo.';
    } catch (err) {
      loadingEl.classList.remove('loading');
      loadingEl.textContent = 'Error al conectar con el asistente. Revisa que /api/chat esté desplegado (esto solo funciona una vez publicado en Vercel, no en preview local sin backend).';
    }
    log.scrollTop = log.scrollHeight;
  });
}

function appendChatMsg(log, text, cls) {
  const div = document.createElement('div');
  div.className = `chat-msg ${cls}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

/* ---------------- Utils ---------------- */

function round1(n) { return typeof n === 'number' ? (Math.round(n * 10) / 10).toLocaleString('es-PA') : n; }
function round2(n) { return typeof n === 'number' ? Math.round(n * 100) / 100 : n; }

document.addEventListener('DOMContentLoaded', init);
