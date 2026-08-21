/* =========================================================
   APP.JS — Interfaz del dashboard (versión modular)
   ========================================================= */

let STATE = null;
let ORDENES_ORIGINALES = null; // copia profunda al cargar, para poder "reiniciar ediciones"
let METODO_ACTUAL = 'recomendada'; // 'promedio' | 'regresion' | 'robusta' | 'recomendada'
let FILTRO_SUCURSAL = 'todas'; // pestaña activa del módulo "Sucursales" ('todas' o el nombre de una sucursal)
let FILTRO_SUCURSAL_INFORMES = 'todas'; // filtros propios del módulo "Informes" (independientes de los de arriba)
let FILTRO_PROVEEDOR_INFORMES = 'todos';
let FILTRO_ESTADO_INFORMES = 'todas';
let FILTRO_SUCURSAL_HISTORICO = 'todas'; // filtro propio del panel "Historial de consumo" — no comparte estado con "Todos los pedidos" de arriba
let SEMANA_INFORMES = null; // se fija a la última semana del histórico una vez cargan los datos
let ORDENES_GRUPO_ABIERTO = { crit: true, olvido: true, warn: true, unknown: true, ok: false }; // estado de cada acordeón, persiste entre renders
let ULTIMA_EDICION = {}; // `${sucursal}|${ingId}` -> timestamp del último cambio manual, para "elevar" ese ítem en su grupo
let FILA_RECIEN_EDITADA = null; // `${sucursal}|${ingId}` del último cambio, para animar solo esa fila una vez
let CURRENT_MODULE = 'resumen';
let TREND_CHART = null; // instancia activa de Chart.js del modal de tendencia (se destruye al reabrir)

const METODOS = [
  { key: 'promedio', label: 'Promedio simple' },
  { key: 'regresion', label: 'Regresión lineal' },
  { key: 'robusta', label: 'Robusta (sin atípicos)' },
  { key: 'recomendada', label: 'Recomendada (combinada)' },
];

const MODULES = ['resumen', 'sucursales', 'proveedores', 'eventos', 'informes', 'anomalias', 'asistente'];

let INICIALIZADO = false;

/* =========================================================
   ⓘ AYUDA (help-hint) — componente único reutilizable.
   Se usa así: `Etiqueta ${helpHint('Texto corto de ayuda.')}`
   Hover en desktop (CSS), tap para abrir/cerrar en móvil (JS de abajo).
   ========================================================= */
function helpHint(texto) {
  return `<span class="help-hint" tabindex="0" role="button" aria-label="Ayuda"><span aria-hidden="true">ⓘ</span><span class="help-popover">${texto}</span></span>`;
}

/* =========================================================
   Los puntos de sucursal ya NO llevan color propio — el color queda
   reservado por completo para el semáforo de estado (ok/warn/crit/
   unknown/olvido), así no compite visualmente con las alertas.
   El punto se mantiene como marcador neutro; la sucursal se identifica
   por el nombre en texto, que siempre lo acompaña.
   ========================================================= */
const SUCURSAL_COLOR_NEUTRO = 'rgba(255,255,255,.35)';
function sucursalColor(nombre) { return SUCURSAL_COLOR_NEUTRO; }
function sucDot(nombre) { return `<span class="suc-dot" style="background:${SUCURSAL_COLOR_NEUTRO}"></span>`; }

// Botón "¿Qué significa el color?" — ahora el color solo tiene un significado en todo
// el dashboard: el semáforo de estado. Las sucursales se distinguen por su nombre.
function colorLegendButton() {
  const estados = [
    ['ok', 'Pedido correcto'],
    ['warn', 'Sobre-pedido'],
    ['crit', 'Riesgo de quiebre'],
    ['olvido', 'Olvidado (no está en la orden)'],
    ['unknown', 'No catalogado'],
  ].map(([k, label]) => `<div class="legend-row"><span class="status-dot ${k}"></span>${label}</div>`).join('');
  const texto = `
    <div class="legend-title">Qué significa cada color</div>${estados}
  `;
  return `<span class="help-hint" tabindex="0" role="button" aria-label="Leyenda de colores"><span aria-hidden="true">🎨</span><span class="help-popover legend-popover">${texto}</span></span>`;
}

function wireHelpHints() {
  // Delegado a nivel documento: funciona con contenido que se re-renderiza (KPIs, tablas, etc.)
  // sin tener que re-enganchar listeners cada vez.
  document.addEventListener('click', (e) => {
    const hint = e.target.closest('.help-hint');
    document.querySelectorAll('.help-hint.open').forEach(h => { if (h !== hint) h.classList.remove('open'); });
    if (hint) {
      e.stopPropagation();
      hint.classList.toggle('open');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.help-hint.open').forEach(h => h.classList.remove('open'));
  });
}

async function init() {
  if (INICIALIZADO) return;
  INICIALIZADO = true;

  STATE = await DataEngine.loadAll();
  ORDENES_ORIGINALES = JSON.parse(JSON.stringify(STATE.ordenes));
  SEMANA_INFORMES = DataEngine.WEEK_ORDER[DataEngine.WEEK_ORDER.length - 1];

  wireTopbar();
  wireHelpHints();
  wireEventosMes();
  renderMethodPills();
  renderAll();

  const inicial = MODULES.includes(location.hash.replace('#', '')) ? location.hash.replace('#', '') : 'resumen';
  switchModule(inicial);

  document.getElementById('loading-screen').classList.add('done');
  wireChat();
}

function renderAll() {
  renderSummaryBar();
  renderEventBanner();
  renderResumen();
  renderSucursales();
  renderProviders();
  renderEventos();
  renderAnomalies();
  renderInformes();
}

/* =========================================================
   NAVEGACIÓN: topbar, módulos, dropdown, animación al scroll
   ========================================================= */

function wireTopbar() {
  // Construir tabs de escritorio (ya están en el HTML) + versión móvil (se genera igual)
  const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
  const mobileTabs = document.getElementById('mobile-tabs');
  mobileTabs.innerHTML = MODULES.map(m => `<button class="tab-btn" data-module="${m}">${labelForModule(m)}</button>`).join('');

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchModule(btn.dataset.module));
  });

  document.getElementById('ver-todas-alertas-btn').addEventListener('click', () => {
    FILTRO_SUCURSAL = 'todas';
    renderAll();
    switchModule('sucursales');
  });

  // Animación del topbar: translúcido arriba del todo -> más sólido con sombra al hacer scroll
  const topbar = document.getElementById('topbar');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) topbar.classList.add('scrolled');
    else topbar.classList.remove('scrolled');
  }, { passive: true });

  // Hamburguesa móvil
  const hamburger = document.getElementById('hamburger-mobile');
  hamburger.addEventListener('click', () => mobileTabs.classList.toggle('open'));

  // "Opciones" ya no vive en el topbar — se mudó al fondo del módulo "Informes"
  // (ver settings-block en index.html), pero las acciones son las mismas.
  document.getElementById('opt-reset').addEventListener('click', reiniciarEdiciones);
  document.getElementById('opt-about').addEventListener('click', mostrarAcercaDe);
  document.getElementById('opt-export-ajustes')?.addEventListener('click', exportarAjustesExcel);

  // La exportación (Excel/PDF general) vive únicamente en el módulo "Informes",
  // para no repetir la misma acción en dos lugares distintos del menú.
  document.getElementById('informes-export-csv')?.addEventListener('click', exportarProveedorExcel);
  document.getElementById('informes-export-excel')?.addEventListener('click', exportarExcel);
  document.getElementById('informes-export-pdf')?.addEventListener('click', () => exportarPDF());
  document.getElementById('informes-export-ajustes-csv')?.addEventListener('click', exportarAjustesExcel);
  document.getElementById('informes-export-pedidos-csv')?.addEventListener('click', exportarPedidosFiltradosExcel);
  document.getElementById('informes-export-historico-csv')?.addEventListener('click', exportarHistoricoExcel);

  // Cerrar el modal de tendencia con Escape, igual que el modal "Acerca de"
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const trendModal = document.getElementById('trend-modal');
      if (trendModal) cerrarTendencia();
    }
  });
}

function labelForModule(m) {
  return { resumen: 'Resumen', sucursales: 'Sucursales', proveedores: 'Proveedores', eventos: 'Eventos', informes: 'Informes', anomalias: 'Anomalías', asistente: 'Asistente IA' }[m] || m;
}

function switchModule(key) {
  if (!MODULES.includes(key)) key = 'resumen';
  CURRENT_MODULE = key;
  document.querySelectorAll('.module').forEach(sec => sec.classList.toggle('active', sec.dataset.module === key));
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.module === key));
  document.getElementById('mobile-tabs').classList.remove('open');
  history.replaceState(null, '', `#${key}`);
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

/* =========================================================
   OPCIONES: exportar CSV, reiniciar, acerca de
   ========================================================= */

function excelCellSafe(v) {
  if (v === undefined || v === null) return '';
  return v;
}

// Descarga un array de filas (array de arrays) como .xlsx de una sola hoja, usando
// autoCols (definido más abajo) para que cada columna se ajuste sola al contenido más
// largo — así se evita el problema de CSV donde, si no ajustás el ancho a mano en Excel,
// una celda larga "se come" visualmente a la de al lado.
function descargarExcelSimple(filas, nombreArchivo, hojaNombre, mensajeToast) {
  if (typeof XLSX === 'undefined') {
    mostrarToast('No se pudo cargar la librería de Excel. Revisa tu conexión e intenta de nuevo.');
    return;
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(filas.map(row => row.map(excelCellSafe)));
  ws['!cols'] = autoCols(filas, { max: 70 });
  XLSX.utils.book_append_sheet(wb, ws, (hojaNombre || 'Hoja1').slice(0, 31));
  XLSX.writeFile(wb, nombreArchivo);
  mostrarToast(mensajeToast || 'Excel exportado.');
}

// Convierte una <table> ya renderizada en el DOM (con el filtro que la gerente tenga puesto)
// a filas (array de arrays), quitando iconos/puntos de estado (celdas sin texto) para que
// quede limpio al exportar. El nombre quedó como "ACSV" en el código pero ahora alimenta
// tanto CSV como Excel — extrae filas de texto, no un formato de archivo en particular.
function tablaVisibleACSV(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return [];
  const headerCells = [...table.querySelectorAll('thead tr th')];
  const colsAOmitir = new Set(headerCells.map((th, i) => th.textContent.trim() === '' ? i : -1).filter(i => i >= 0));

  const filas = [];
  table.querySelectorAll('thead tr').forEach(tr => {
    filas.push([...tr.children].filter((td, i) => !colsAOmitir.has(i)).map(td => td.textContent.trim()));
  });
  table.querySelectorAll('tbody tr').forEach(tr => {
    const celdas = [...tr.children].filter((td, i) => !colsAOmitir.has(i)).map(td => td.textContent.trim());
    if (celdas.some(c => c)) filas.push(celdas); // se salta la fila de "no hay datos"
  });
  return filas;
}

// Agrupado por proveedor (con encabezado propio por bloque) en vez de una sola tabla
// plana gigante, y con una COLUMNA por sucursal (formato pivote) en vez de un texto tipo
// "Costa del Este: 5 | Marbella: 10" metido en una sola celda — así ninguna fila esconde
// datos detrás de otra al abrir el archivo en Excel/Sheets, cada número vive en su propia
// celda.
function exportarProveedorExcel() {
  const data = DataEngine.pedidoCorregidoPorProveedor(STATE, METODO_ACTUAL);
  const fecha = new Date().toLocaleDateString('es-PA');
  const filas = [];
  filas.push(['BARRIO PIZZA - Pedido corregido por proveedor']);
  filas.push([`Generado: ${fecha}`, `Metodo de proyeccion: ${METODOS.find(m => m.key === METODO_ACTUAL).label}`]);
  filas.push([]);

  const proveedores = Object.keys(data).sort();
  if (!proveedores.length) {
    filas.push(['No hay necesidades de compra pendientes con los datos actuales.']);
  }
  proveedores.forEach(prov => {
    filas.push([prov.toUpperCase()]);
    filas.push(['Ingrediente', 'Formato de compra', ...STATE.sucursales, 'Total a pedir']);
    Object.values(data[prov]).forEach(it => {
      const porSucursal = {};
      it.detalle.forEach(d => { porSucursal[d.sucursal] = d.formatos; });
      filas.push([it.nombre, it.formato, ...STATE.sucursales.map(s => porSucursal[s] ?? ''), it.total]);
    });
    filas.push([]); // línea en blanco entre proveedores, para que se vea como bloques separados
  });

  descargarExcelSimple(filas, `barrio-pizza-pedido-por-proveedor-${new Date().toISOString().split('T')[0]}.xlsx`, 'Por proveedor', 'Excel exportado — una fila por ingrediente, una columna por sucursal, agrupado por proveedor.');
}

function exportarAjustesExcel() {
  const cambios = calcularEdicionesGerente();
  if (!cambios.length) { mostrarToast('Todavía no hay ajustes que exportar — edita alguna cantidad en "Sucursales" primero.'); return; }
  const filas = [
    ['BARRIO PIZZA - Ajustes hechos por la gerente'],
    [`Generado: ${new Date().toLocaleDateString('es-PA')}`],
    [],
    ['Sucursal', 'Ingrediente', 'Pedido original', 'Pedido corregido', 'Diferencia'],
    ...cambios.map(c => [c.sucursal, c.nombre, round1(c.antes), round1(c.ahora), (c.diferencia > 0 ? '+' : '') + round1(c.diferencia)]),
  ];
  descargarExcelSimple(filas, `barrio-pizza-ajustes-${new Date().toISOString().split('T')[0]}.xlsx`, 'Ajustes', 'Excel de ajustes exportado.');
}

function exportarPedidosFiltradosExcel() {
  const filas = tablaVisibleACSV('informes-full-table');
  if (filas.length < 2) { mostrarToast('No hay pedidos que coincidan con el filtro actual.'); return; }
  filas.unshift(['BARRIO PIZZA - Pedidos (filtro aplicado en Informes)'], [`Generado: ${new Date().toLocaleDateString('es-PA')}`], []);
  descargarExcelSimple(filas, `barrio-pizza-pedidos-filtrados-${new Date().toISOString().split('T')[0]}.xlsx`, 'Pedidos filtrados', 'Excel de pedidos filtrados exportado.');
}

function exportarHistoricoExcel() {
  const filas = tablaVisibleACSV('informes-historico-table');
  if (filas.length < 2) { mostrarToast('No hay datos de consumo para esta semana/filtro.'); return; }
  filas.unshift(['BARRIO PIZZA - Historial de consumo'], [`Generado: ${new Date().toLocaleDateString('es-PA')}`], []);
  descargarExcelSimple(filas, `barrio-pizza-historico-${new Date().toISOString().split('T')[0]}.xlsx`, 'Historial', 'Excel de historial exportado.');
}

function mostrarToast(mensaje) {
  const existente = document.getElementById('toast-msg');
  if (existente) existente.remove();
  const toast = document.createElement('div');
  toast.id = 'toast-msg';
  toast.className = 'toast-msg';
  toast.textContent = mensaje;
  document.body.appendChild(toast);
  const raf = window.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
  raf(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2600);
}

/* ---------------- Export a Excel (multi-hoja, con SheetJS) ---------------- */

// Antes los anchos de columna eran fijos (ej. 20/26/16/22) sin importar el contenido real,
// así que cualquier texto más largo que eso (nombres de ingrediente largos, "Acción sugerida",
// detalle por sucursal, etc.) se veía pegado/cortado contra la columna de al lado.
// Este helper calcula el ancho según el string más largo de cada columna (header incluido).
function autoCols(rows, { min = 8, max = 60, padding = 2 } = {}) {
  const numCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const widths = [];
  for (let c = 0; c < numCols; c++) {
    let w = min;
    for (const row of rows) {
      const cell = row[c];
      if (cell === undefined || cell === null || cell === '') continue;
      w = Math.max(w, String(cell).length + padding);
    }
    widths.push({ wch: Math.min(w, max) });
  }
  return widths;
}

function exportarExcel() {
  if (typeof XLSX === 'undefined') {
    mostrarToast('No se pudo cargar la librería de Excel. Revisa tu conexión e intenta de nuevo.');
    return;
  }

  const wb = XLSX.utils.book_new();
  const fecha = new Date().toLocaleDateString('es-PA');

  // ---- Hoja 1: Resumen (KPIs por sucursal) ----
  const filas = DataEngine.todasLasFilas(STATE, METODO_ACTUAL);
  const olvidos = DataEngine.alertasOlvido(STATE);
  const resumenRows = [
    ['Barrio Pizza — Resumen de órdenes de compra', '', '', ''],
    [`Generado: ${fecha}`, `Método de proyección: ${METODOS.find(m => m.key === METODO_ACTUAL).label}`, '', ''],
    [],
    ['Sucursal', 'Se puede quedar sin stock', 'Sobre-pedido', 'Ingredientes olvidados'],
  ];
  STATE.sucursales.forEach(suc => {
    const f = filas.filter(x => x.sucursal === suc);
    const o = olvidos.filter(x => x.sucursal === suc);
    resumenRows.push([
      suc,
      f.filter(x => x.status === 'crit' && x.enOrden !== false).length,
      f.filter(x => x.status === 'warn').length,
      o.length,
    ]);
  });
  const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
  wsResumen['!cols'] = autoCols(resumenRows);
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  // ---- Hoja 2: Todas las alertas, con motivo y acción sugerida ----
  const alertRows = [['Sucursal', 'Ingrediente', 'Tipo de alerta', 'Proyección', 'Stock', 'Pedido', 'Unidad', 'Acción sugerida']];
  // enOrden !== false: los olvidados se agregan abajo (vía `olvidos.forEach`), aquí se
  // excluyen para no duplicar la fila del mismo ingrediente con dos etiquetas distintas.
  filas.filter(f => f.status !== 'ok' && f.enOrden !== false).forEach(f => {
    alertRows.push([
      f.sucursal, f.nombre, estadoLabel(f),
      round2(f.proyeccion), round2(f.stock), round2(f.pedidoBase),
      f.unidad || '', DataEngine.accionSugerida(f),
    ]);
  });
  olvidos.forEach(o => {
    alertRows.push([o.sucursal, o.nombre, 'Posible olvido', '', '', '', '', DataEngine.accionSugeridaOlvido()]);
  });
  const wsAlertas = XLSX.utils.aoa_to_sheet(alertRows);
  wsAlertas['!cols'] = autoCols(alertRows, { max: 70 });
  XLSX.utils.book_append_sheet(wb, wsAlertas, 'Todas las alertas');

  // ---- Una hoja por proveedor, lista para reenviar ----
  const porProveedor = DataEngine.pedidoCorregidoPorProveedor(STATE, METODO_ACTUAL);
  Object.keys(porProveedor).sort().forEach(prov => {
    const rows = [['Ingrediente', 'Formato de compra', 'Cantidad recomendada']];
    Object.values(porProveedor[prov]).forEach(it => rows.push([it.nombre, it.formato, it.total]));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = autoCols(rows);
    // Nombres de hoja de Excel: máx 31 caracteres, sin caracteres especiales
    const sheetName = prov.replace(/[\\/*?:[\]]/g, '').slice(0, 31) || 'Proveedor';
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  XLSX.writeFile(wb, `barrio-pizza-compras-${new Date().toISOString().split('T')[0]}.xlsx`);
  mostrarToast('Excel exportado — una hoja por proveedor, lista para reenviar.');
}

/* ---------------- Export a PDF (jsPDF + autoTable), listo para imprimir/enviar ---------------- */

// Si se pasa "soloProveedor", genera el PDF solo con el bloque de ese proveedor
// (lo usa el botón "📄 PDF" de cada tarjeta en el módulo Proveedores). Sin argumento,
// exporta todos los proveedores en un solo archivo (un bloque por página), como antes.
function exportarPDF(soloProveedor) {
  if (typeof window.jspdf === 'undefined') {
    mostrarToast('No se pudo cargar la librería de PDF. Revisa tu conexión e intenta de nuevo.');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const rojo = [207, 47, 44];
  const negro = [35, 31, 32];
  const fecha = new Date().toLocaleDateString('es-PA');
  const porProveedor = DataEngine.pedidoCorregidoPorProveedor(STATE, METODO_ACTUAL);
  let proveedores = Object.keys(porProveedor).sort();
  if (soloProveedor) proveedores = proveedores.filter(p => p === soloProveedor);

  if (!proveedores.length) {
    mostrarToast(soloProveedor
      ? `No hay necesidades de compra pendientes para ${soloProveedor}.`
      : 'No hay necesidades de compra pendientes para exportar.');
    return;
  }

  proveedores.forEach((prov, i) => {
    if (i > 0) doc.addPage();
    doc.setFillColor(...negro);
    doc.rect(0, 0, doc.internal.pageSize.getWidth(), 70, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('BARRIO PIZZA · Pedido corregido', 40, 32);
    doc.setFontSize(10);
    doc.setTextColor(...rojo);
    doc.text(`Proveedor: ${prov}`, 40, 52);
    doc.setTextColor(220, 220, 220);
    doc.text(`Generado: ${fecha}`, doc.internal.pageSize.getWidth() - 150, 52);

    const items = Object.values(porProveedor[prov]);
    doc.autoTable({
      startY: 90,
      head: [['Ingrediente', 'Formato de compra', 'Cantidad recomendada']],
      body: items.map(it => [it.nombre, it.formato, String(it.total)]),
      headStyles: { fillColor: rojo, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      styles: { fontSize: 10, cellPadding: 6 },
      margin: { left: 40, right: 40 },
    });

    doc.setTextColor(140, 140, 140);
    doc.setFontSize(8);
    doc.text('Basado en la necesidad real proyectada — no es lo que pidieron, es lo que recomendamos comprar.', 40, doc.internal.pageSize.getHeight() - 30);
  });

  const fechaArchivo = new Date().toISOString().split('T')[0];
  doc.save(soloProveedor
    ? `barrio-pizza-pedido-${slugify(soloProveedor)}-${fechaArchivo}.pdf`
    : `barrio-pizza-pedido-${fechaArchivo}.pdf`);
  mostrarToast(soloProveedor
    ? `PDF de ${soloProveedor} exportado — listo para imprimir o enviar.`
    : 'PDF exportado — un bloque por proveedor, listo para imprimir o enviar.');
}

function slugify(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Copia al portapapeles un texto plano con el pedido de un proveedor — pensado para
// pegar directo en WhatsApp o en el cuerpo de un correo, sin pasar por PDF/Excel.
function copiarPedidoProveedor(prov) {
  const data = DataEngine.pedidoCorregidoPorProveedor(STATE, METODO_ACTUAL);
  const items = data[prov];
  if (!items) {
    mostrarToast(`No hay pedido pendiente para ${prov}.`);
    return;
  }
  const fecha = new Date().toLocaleDateString('es-PA');
  let texto = `*BARRIO PIZZA — Pedido a ${prov}*\n${fecha}\n\n`;
  Object.values(items).forEach(it => {
    texto += `• ${it.nombre}: ${it.total} × ${it.formato}\n`;
  });
  texto += `\n¡Gracias!`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texto)
      .then(() => mostrarToast(`Pedido de ${prov} copiado — pégalo en WhatsApp o correo.`))
      .catch(() => mostrarToast('No se pudo copiar automáticamente. Intenta de nuevo.'));
  } else {
    mostrarToast('Tu navegador no soporta copiar automáticamente.');
  }
}

function reiniciarEdiciones() {
  STATE.ordenes = JSON.parse(JSON.stringify(ORDENES_ORIGINALES));
  ULTIMA_EDICION = {};
  FILA_RECIEN_EDITADA = null;
  renderAll();
}

function mostrarAcercaDe() {
  const existente = document.getElementById('about-modal');
  if (existente) { existente.remove(); return; }

  const modal = document.createElement('div');
  modal.id = 'about-modal';
  modal.className = 'about-modal-overlay';
  modal.innerHTML = `
    <div class="about-modal-box">
      <button class="about-modal-close" id="about-modal-close">&times;</button>
      <h3>Acerca de este dashboard</h3>
      <p>Revisa automáticamente las órdenes de compra semanales de 4 sucursales de Barrio Pizza, proyecta el consumo con 4 métodos distintos, y genera alertas cuando una sucursal pide de más, de menos, o se olvida de algo.</p>
      <p class="text-muted" style="margin-top:.8rem">Proyecto de Alpha Vilchez para Pasantía en Barrio Pizza — construido con HTML/CSS/JS y Gemini 2.5 Flash para el asistente de datos.</p>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.getElementById('about-modal-close').addEventListener('click', () => modal.remove());
}

/* ---------------- Modal de tendencia (Chart.js) ---------------- */

function cerrarTendencia() {
  const modal = document.getElementById('trend-modal');
  if (modal) modal.remove();
  if (TREND_CHART) { TREND_CHART.destroy(); TREND_CHART = null; }
}

function mostrarTendencia(sucursal, ingId) {
  cerrarTendencia(); // por si ya había uno abierto

  const cat = STATE.catalogo[ingId];
  const proy = DataEngine.proyeccionesPara(STATE, sucursal, ingId);
  const stock = ((STATE.inventario[sucursal] || {})[ingId]) ?? 0;
  const unidad = cat ? cat.unidad_base : '';
  const nombre = cat ? cat.nombre : ingId;

  const diferencia = round1(proy.recomendada - stock);
  const diffTxt = diferencia > 0
    ? `Faltan <b>${diferencia} ${unidad}</b> por pedir`
    : diferencia < 0
      ? `Sobran <b>${Math.abs(diferencia)} ${unidad}</b> respecto a lo proyectado`
      : `Stock justo a lo proyectado`;
  const diffClass = diferencia > 0 ? 'crit' : diferencia < 0 ? 'warn' : 'ok';

  const modal = document.createElement('div');
  modal.id = 'trend-modal';
  modal.className = 'about-modal-overlay';
  modal.innerHTML = `
    <div class="about-modal-box trend-modal-box">
      <button class="about-modal-close" id="trend-modal-close">&times;</button>
      <h3>${nombre}</h3>
      <p class="text-muted" style="margin-bottom:1rem">${sucursal} · consumo de las últimas 6 semanas + proyección</p>
      <div class="chart-canvas-wrap"><canvas id="trend-canvas"></canvas></div>
      <div class="trend-stats">
        <div class="trend-stat">
          <span class="trend-stat-label">Stock actual</span>
          <span class="trend-stat-value">${round1(stock)} <small>${unidad}</small></span>
        </div>
        <div class="trend-stat">
          <span class="trend-stat-label">Proyección recomendada</span>
          <span class="trend-stat-value">${round1(proy.recomendada)} <small>${unidad}</small></span>
        </div>
      </div>
      <div class="trend-diff trend-diff-${diffClass}">${diffTxt}</div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) cerrarTendencia(); });
  document.getElementById('trend-modal-close').addEventListener('click', cerrarTendencia);

  if (typeof Chart === 'undefined') return; // Chart.js no cargó (sin conexión) — el modal igual muestra los números

  const labels = [...DataEngine.WEEK_ORDER, 'Proyección'];
  const historico = [...proy.serie, null];
  const proyectado = new Array(proy.serie.length).fill(null);
  proyectado.push(proy.recomendada);

  const ctx = document.getElementById('trend-canvas').getContext('2d');
  TREND_CHART = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Consumo real', data: historico,
          borderColor: '#e0932c', backgroundColor: 'rgba(224,147,44,.15)',
          tension: 0.25, spanGaps: false, pointRadius: 4,
        },
        {
          label: 'Proyección recomendada', data: proyectado,
          borderColor: '#CF2F2C', backgroundColor: '#CF2F2C',
          pointRadius: 6, pointStyle: 'rectRot', showLine: false,
        },
        {
          label: 'Stock actual', data: labels.map(() => stock),
          borderColor: 'rgba(47,158,81,.7)', borderDash: [6, 4],
          pointRadius: 0, pointStyle: 'dash', fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: 'rgba(255,255,255,.75)', font: { family: 'JetBrains Mono', size: 10 },
            usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 16,
          },
        },
      },
      scales: {
        x: { ticks: { color: 'rgba(255,255,255,.6)' }, grid: { color: 'rgba(255,255,255,.06)' } },
        y: { ticks: { color: 'rgba(255,255,255,.6)' }, grid: { color: 'rgba(255,255,255,.06)' }, beginAtZero: true },
      },
    },
  });
}

/* ---------------- Barra de resumen (chips compactos) ---------------- */

function renderSummaryBar() {
  renderSummaryBarInto('status-summary-bar');
}

// Misma barra de chips, reutilizable con cualquier id (se usa también en Informes).
// Cada chip trae su ⓘ con el detalle/texto largo — es la única versión de este
// resumen en el Dashboard (antes se repetía también en la fila de KPIs grandes).
function renderSummaryBarInto(elId) {
  const bar = document.getElementById(elId);
  if (!bar) return;
  const filas = DataEngine.todasLasFilas(STATE, METODO_ACTUAL);
  const olvidos = DataEngine.alertasOlvido(STATE);
  const crit = filas.filter(f => f.status === 'crit' && f.enOrden !== false).length;
  const warn = filas.filter(f => f.status === 'warn').length;
  const unknown = filas.filter(f => f.status === 'unknown').length;
  const ok = filas.filter(f => f.status === 'ok').length;

  const chips = [
    { n: ok, label: 'correctas', cls: 'ok', help: 'La cantidad pedida está bien ajustada a lo que se proyecta que la sucursal va a consumir.' },
    { n: warn, label: 'sobre-pedido', cls: 'warn', help: 'La sucursal pidió más de lo que va a necesitar según la proyección. En ingredientes que vencen rápido, puede significar desperdicio.' },
    { n: crit, label: 'sin stock', cls: 'crit', help: 'La sucursal sí pidió este ingrediente, pero pidió menos de lo que va a necesitar según la proyección.' },
    { n: olvidos.length, label: 'olvidos', cls: 'crit', help: 'La sucursal ni siquiera puso este ingrediente en su orden esta semana — no es que pidió poco, es que no aparece.' },
    { n: unknown, label: 'no catalogados', cls: 'unknown', help: 'El ingrediente está en la orden pero no existe en el catálogo, así que no se puede calcular si alcanza o no.' },
  ];

  bar.innerHTML = chips.map((c, i) => `
    <div class="summary-chip ${c.cls}" style="animation-delay:${i * 0.06}s">
      <span class="summary-chip-num">${c.n}</span>
      <span class="summary-chip-label">${c.label}${helpHint(c.help)}</span>
    </div>
  `).join('');
}

/* ---------------- Módulo Resumen: semáforo + top alertas ---------------- */

function renderResumen() {
  const grid = document.getElementById('branch-status-grid');
  grid.innerHTML = STATE.sucursales.map(suc => {
    const filas = DataEngine.todasLasFilas(STATE, METODO_ACTUAL).filter(f => f.sucursal === suc);
    const olvidos = DataEngine.alertasOlvido(STATE).filter(o => o.sucursal === suc);
    const crit = filas.filter(f => f.status === 'crit' && f.enOrden !== false).length + olvidos.length;
    const warn = filas.filter(f => f.status === 'warn').length;
    const unknown = filas.filter(f => f.status === 'unknown').length;

    let color = 'green', msg = 'Todo en orden, sin problemas detectados.';
    if (crit > 0) { color = 'red'; msg = `${crit} problema${crit === 1 ? '' : 's'} urgente${crit === 1 ? '' : 's'} — revisar ya.`; }
    else if (warn > 0 || unknown > 0) { color = 'blue'; msg = `${warn + unknown} cosa${warn + unknown === 1 ? '' : 's'} para revisar cuando puedas.`; }

    return `
      <div class="branch-status-card" data-suc="${suc}">
        <div class="branch-status-top">
          <span class="status-light ${color}"></span>
          <span class="branch-status-name">${suc}</span>
        </div>
        <div class="branch-status-msg">${msg}</div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.branch-status-card').forEach(card => {
    card.addEventListener('click', () => {
      FILTRO_SUCURSAL = card.dataset.suc;
      renderAll();
      switchModule('sucursales');
    });
  });

  // Top 5 alertas más urgentes (sin filtrar por sucursal, siempre panorama completo)
  const cards = construirAlertCards('todas').slice(0, 5);
  const list = document.getElementById('top-alert-list');
  if (!cards.length) {
    list.innerHTML = `<p class="text-muted" style="padding:1rem">No hay alertas activas — todo en orden ✅</p>`;
  } else {
    list.innerHTML = cards.map((c, i) => alertCardHTML(c, i)).join('');
  }
}

/* ---------------- Módulo Eventos: calendario + banner de aviso ---------------- */
//
// Fuentes: state.eventos (armado en DataEngine a partir de eventos_historicos.csv —
// el calendario "oficial" de feriados de ley y fechas comerciales de Panamá) MÁS
// los eventos personalizados que la gerente va creando desde la interfaz, que se
// guardan en localStorage (DataEngine.crearEventoPersonalizado / eliminarEventoPersonalizado)
// para que persistan entre visitas sin necesitar backend. DataEngine.calendarioEventos()
// calcula la próxima ocurrencia real de cada uno (mes/día se repite cada año, salvo los
// personalizados marcados como "una sola vez") y cuántos días faltan.

const VENTANA_AVISO_DIAS = 7; // a partir de cuántos días antes aparece el banner
const CATEGORIAS_EVENTO = ['Feriado nacional', 'Feriado local', 'Fecha comercial', 'Fecha deportiva', 'Estacional', 'Personalizado'];
const NOMBRES_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const NOMBRES_DIA_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

let EVENTOS_MES_VISTA = new Date(new Date().getFullYear(), new Date().getMonth(), 1); // mes que muestra la grilla

function eventCountdownLabel(dias) {
  if (dias === 0) return 'HOY';
  if (dias === 1) return 'MAÑANA';
  return `EN ${dias} DÍAS`;
}

function eventCountdownLabelLower(dias) {
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'mañana';
  return `en ${dias} días`;
}

function fechaISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Card compacta — solo para el slot de Resumen/Dashboard. Sin barra por sucursal,
// sin botón, sin categoría, sin acción sugerida.
function eventoBannerCompactHTML(e) {
  const dir = e.sinEstimado ? '' : (e.alzaPromedio >= 0 ? 'up' : 'down');
  const pctTxt = e.sinEstimado
    ? `<span class="pem-pct-label">sin estimado</span>`
    : `<span class="pem-pct ${dir}">${e.alzaPromedio >= 0 ? '+' : ''}${round1(e.alzaPromedio)}%</span>`;
  return `
    <div class="proximo-evento-mini" style="animation-delay:0s">
      <div class="pem-label">Próximo evento · ${eventCountdownLabelLower(e.diasFaltantes)}</div>
      <div class="pem-nombre-row">
        <span class="pem-nombre">${e.nombre}</span>
        ${pctTxt}
      </div>
    </div>
  `;
}

// Card detallada — solo para el slot del módulo Eventos. Desglose colapsable por
// sucursal, ordenado de mayor a menor alza.
function eventoBannerDetailedHTML(e) {
  const impacto = e.sinEstimado
    ? `sin estimado histórico todavía (evento nuevo)`
    : `${e.alzaPromedio >= 0 ? 'alza' : 'baja'} histórica promedio de <b>${e.alzaPromedio >= 0 ? '+' : ''}${round1(e.alzaPromedio)}%</b> en ventas`;

  const filasOrdenadas = STATE.sucursales
    .map(s => ({ suc: s, v: e.porSucursal[s] }))
    .filter(f => typeof f.v === 'number' && !isNaN(f.v))
    .sort((a, b) => b.v - a.v);

  const bars = filasOrdenadas.map(({ suc, v }) => {
    const ancho = Math.min(100, Math.abs(v));
    const dir = v >= 0 ? 'up' : 'down';
    return `
      <div class="evento-bar-row">
        <span class="evento-bar-suc">${sucDot(suc)}${suc}</span>
        <div class="evento-bar-track">
          <div class="evento-bar-fill ${dir}" style="width:${ancho}%"></div>
        </div>
        <span class="evento-bar-val ${dir}">${v >= 0 ? '+' : ''}${round1(v)}%</span>
      </div>
    `;
  }).join('');

  const desglose = bars ? `
    <div class="evento-banner-toggle" data-evento-banner-toggle="1">Ver desglose por sucursal ▾</div>
    <div class="evento-card-detalle">${bars}</div>
  ` : '';

  return `
    <div class="alert-card info evento-banner evento-banner-detailed" style="animation-delay:0s">
      <div class="alert-top">
        <span class="alert-tag">PRÓXIMO EVENTO · ${eventCountdownLabel(e.diasFaltantes)}</span>
      </div>
      <div class="alert-msg">
        <b>${e.nombre}</b> (${e.categoria}) — ${impacto}.
      </div>
      ${desglose}
      <div class="accion-sugerida">→ Revisa si conviene reforzar el pedido de esta semana antes de cerrarlo, especialmente en las sucursales más afectadas.</div>
    </div>
  `;
}

// Rellena el aviso compacto en Resumen (1 evento) y el/los aviso(s) detallados en el
// módulo Eventos (hasta 2, ej. una fecha comercial y un feriado nacional cayendo la
// misma semana), cada uno con su propio formato.
function renderEventBanner() {
  const compacto = DataEngine.eventosProximos(STATE, VENTANA_AVISO_DIAS, null, 1);
  const slotResumen = document.getElementById('evento-banner-slot');
  if (slotResumen) slotResumen.innerHTML = compacto.map(eventoBannerCompactHTML).join('');

  const detallado = DataEngine.eventosProximos(STATE, VENTANA_AVISO_DIAS, null, 2);
  const slotEventos = document.getElementById('evento-banner-slot-eventos');
  if (slotEventos) {
    slotEventos.innerHTML = detallado.map(eventoBannerDetailedHTML).join('');
    slotEventos.querySelectorAll('[data-evento-banner-toggle]').forEach(t => {
      t.addEventListener('click', () => {
        const card = t.closest('.evento-banner-detailed');
        card.classList.toggle('open');
        t.textContent = card.classList.contains('open')
          ? 'Ocultar desglose por sucursal ▲'
          : 'Ver desglose por sucursal ▾';
      });
    });
  }
}

function renderEventos() {
  const cont = document.getElementById('eventos-calendar');
  if (!cont) return;

  const helpSlot = document.getElementById('eventos-help-slot');
  if (helpSlot && !helpSlot.dataset.wired) {
    helpSlot.innerHTML = helpHint('El % de alza o baja se calculó comparando el índice de ventas de la semana del evento contra el promedio de las semanas normales alrededor, por sucursal — no es un número inventado a ojo. Los eventos que agregues tú no tienen ese cálculo hasta que pase al menos una edición y se pueda comparar contra lo normal.');
    helpSlot.dataset.wired = '1';
  }

  const calendario = DataEngine.calendarioEventos(STATE);
  if (!calendario.length) {
    cont.innerHTML = `<p class="text-muted">No hay eventos próximos — agrega uno con "+ Nuevo evento" arriba.</p>`;
  } else {
    cont.innerHTML = calendario.map((e, i) => {
      const positivo = e.alzaPromedio >= 0;
      const bars = STATE.sucursales.map(suc => {
        const v = e.porSucursal[suc];
        if (typeof v !== 'number' || isNaN(v)) return '';
        const ancho = Math.min(100, Math.abs(v));
        const dir = v >= 0 ? 'up' : 'down';
        return `
          <div class="evento-bar-row">
            <span class="evento-bar-suc">${sucDot(suc)}${suc}</span>
            <div class="evento-bar-track">
              <div class="evento-bar-fill ${dir}" style="width:${ancho}%"></div>
            </div>
            <span class="evento-bar-val ${dir}">${v >= 0 ? '+' : ''}${round1(v)}%</span>
          </div>
        `;
      }).join('');

      const alzaTxt = e.sinEstimado ? `<span class="evento-card-alza-label">sin estimado</span>` : `${positivo ? '+' : ''}${round1(e.alzaPromedio)}%<span class="evento-card-alza-label">${positivo ? 'alza' : 'baja'} promedio</span>`;
      const badge = e.base ? `<span class="evento-card-badge base">Oficial</span>` : `<span class="evento-card-badge custom">Personalizado</span>`;
      const borrar = e.base ? '' : `<button class="evento-card-delete" data-borrar-evento="${e.id}" type="button">🗑 Borrar</button>`;

      return `
        <div class="evento-card" data-evento="${i}" style="animation-delay:${Math.min(i, 8) * 0.03}s">
          <div class="evento-card-top">
            <div>
              <div class="evento-card-fecha">${eventCountdownLabel(e.diasFaltantes)} · ${e.proximaFecha.toLocaleDateString('es-PA', { day: 'numeric', month: 'long' })}</div>
              <div class="evento-card-nombre">${e.nombre}${badge}</div>
              <div class="evento-card-categoria">${e.categoria}</div>
            </div>
            <div class="evento-card-alza ${e.sinEstimado ? '' : (positivo ? 'up' : 'down')}">${alzaTxt}</div>
          </div>
          <div class="evento-card-detalle">${bars}${e.notas ? `<p class="text-muted" style="margin-top:.5rem">${e.notas}</p>` : ''}${borrar}</div>
        </div>
      `;
    }).join('');

    cont.querySelectorAll('.evento-card').forEach(card => {
      card.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-borrar-evento]')) return;
        card.classList.toggle('open');
      });
    });
    cont.querySelectorAll('[data-borrar-evento]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (confirm('¿Borrar este evento personalizado? Esta acción no se puede deshacer.')) {
          DataEngine.eliminarEventoPersonalizado(btn.dataset.borrarEvento);
          renderAll();
        }
      });
    });
  }

  renderEventosMes();
}

/* ---------------- Calendario mensual: grilla real de días ---------------- */

function wireEventosMes() {
  document.getElementById('eventos-nuevo-btn')?.addEventListener('click', () => abrirFormularioEvento());
  document.getElementById('eventos-month-prev')?.addEventListener('click', () => {
    EVENTOS_MES_VISTA = new Date(EVENTOS_MES_VISTA.getFullYear(), EVENTOS_MES_VISTA.getMonth() - 1, 1);
    renderEventosMes();
  });
  document.getElementById('eventos-month-next')?.addEventListener('click', () => {
    EVENTOS_MES_VISTA = new Date(EVENTOS_MES_VISTA.getFullYear(), EVENTOS_MES_VISTA.getMonth() + 1, 1);
    renderEventosMes();
  });
  document.getElementById('eventos-month-today')?.addEventListener('click', () => {
    const hoy = new Date();
    EVENTOS_MES_VISTA = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    renderEventosMes();
  });
  const weekdaysCont = document.getElementById('eventos-grid-weekdays');
  if (weekdaysCont) weekdaysCont.innerHTML = NOMBRES_DIA_SEMANA.map(d => `<span>${d}</span>`).join('');
}

function renderEventosMes() {
  const grid = document.getElementById('eventos-grid');
  const label = document.getElementById('eventos-month-label');
  if (!grid || !label || !STATE) return;

  const year = EVENTOS_MES_VISTA.getFullYear();
  const month = EVENTOS_MES_VISTA.getMonth();
  label.textContent = `${NOMBRES_MES[month]} ${year}`;

  const hoy = new Date();
  const hoy0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());

  const primerDia = new Date(year, month, 1);
  // Lunes = 0 ... Domingo = 6 (getDay() da 0=domingo, así que lo corremos)
  const offsetInicio = (primerDia.getDay() + 6) % 7;
  const diasEnMes = new Date(year, month + 1, 0).getDate();
  const diasMesAnterior = new Date(year, month, 0).getDate();

  const eventosDelMes = DataEngine.eventosEnMes(STATE, year, month);
  const eventosPorDia = {};
  eventosDelMes.forEach(e => {
    eventosPorDia[e.diaDelMes] = eventosPorDia[e.diaDelMes] || [];
    eventosPorDia[e.diaDelMes].push(e);
  });

  const celdas = [];
  // Cola del mes anterior, para completar la primera semana visualmente
  for (let i = offsetInicio - 1; i >= 0; i--) {
    celdas.push({ dia: diasMesAnterior - i, outside: true });
  }
  for (let d = 1; d <= diasEnMes; d++) {
    celdas.push({ dia: d, outside: false, fecha: new Date(year, month, d) });
  }
  // Completar hasta múltiplo de 7
  let siguienteMesDia = 1;
  while (celdas.length % 7 !== 0) {
    celdas.push({ dia: siguienteMesDia++, outside: true });
  }

  grid.innerHTML = celdas.map(c => {
    if (c.outside) {
      return `<div class="eventos-day outside"><span class="eventos-day-num">${c.dia}</span></div>`;
    }
    const esHoy = c.fecha.getTime() === hoy0.getTime();
    const eventosDia = eventosPorDia[c.dia] || [];
    const chips = eventosDia.map(e => {
      const dir = e.sinEstimado ? '' : (e.alzaPromedio >= 0 ? 'up' : 'down');
      const pctTxt = e.sinEstimado ? '' : `${e.alzaPromedio >= 0 ? '+' : ''}${round1(e.alzaPromedio)}%`;
      const tituloAttr = `${e.nombre}${pctTxt ? ' (' + pctTxt + ')' : ''}`;
      return `<span class="eventos-day-chip ${dir}" data-evento-chip="${e.id}" data-evento-fecha="${fechaISO(c.fecha)}" title="${tituloAttr}"><span class="eventos-day-chip-name">${e.nombre}</span>${pctTxt ? `<span class="eventos-day-chip-pct">${pctTxt}</span>` : ''}</span>`;
    }).join('');
    return `
      <div class="eventos-day ${esHoy ? 'today' : ''}" data-dia-fecha="${fechaISO(c.fecha)}">
        <span class="eventos-day-num">${c.dia}</span>
        ${chips}
        <span class="eventos-day-add">+ agregar</span>
      </div>
    `;
  }).join('');

  // Clic en un chip de evento personalizado -> abrir para editar/borrar. Clic en el resto
  // de la celda (o en un chip "Oficial") -> crear uno nuevo con esa fecha precargada.
  grid.querySelectorAll('[data-evento-chip]').forEach(chip => {
    chip.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const id = chip.dataset.eventoChip;
      if (String(id).startsWith('custom:')) {
        const existente = DataEngine.eventosPersonalizados().find(e => e.id === id);
        if (existente) abrirFormularioEvento(chip.dataset.eventoFecha, existente);
      } else {
        switchModule('eventos'); // eventos oficiales se consultan en la lista de abajo, no se editan acá
      }
    });
  });
  grid.querySelectorAll('.eventos-day:not(.outside)').forEach(cell => {
    cell.addEventListener('click', () => abrirFormularioEvento(cell.dataset.diaFecha));
  });
}

/* ---------------- Modal "Nuevo evento" / editar evento personalizado ---------------- */

function cerrarFormularioEvento() {
  const modal = document.getElementById('evento-form-modal');
  if (modal) modal.remove();
}

function abrirFormularioEvento(fechaPrellenada, eventoExistente) {
  cerrarFormularioEvento();

  const esEdicion = !!eventoExistente;
  const fechaValor = eventoExistente ? eventoExistente.fecha : (fechaPrellenada || fechaISO(new Date()));
  const catOptions = CATEGORIAS_EVENTO.map(c => `<option value="${c}" ${eventoExistente && eventoExistente.categoria === c ? 'selected' : ''}>${c}</option>`).join('');

  const modal = document.createElement('div');
  modal.id = 'evento-form-modal';
  modal.className = 'about-modal-overlay';
  modal.innerHTML = `
    <div class="about-modal-box">
      <button class="about-modal-close" id="evento-form-close">&times;</button>
      <h3>${esEdicion ? 'Editar evento' : 'Nuevo evento'}</h3>
      <p class="text-muted" style="margin-bottom:1rem;font-size:.8rem">
        Se guarda en este navegador y aparece en el calendario y en los avisos de Resumen apenas se acerque la fecha.
      </p>
      <p class="evento-form-error" id="evento-form-error"></p>
      <div class="evento-form-row">
        <label for="evento-form-nombre">Nombre del evento</label>
        <input type="text" id="evento-form-nombre" maxlength="80" value="${eventoExistente ? eventoExistente.nombre.replace(/"/g, '&quot;') : ''}" placeholder="Ej. Promo aniversario Costa del Este">
      </div>
      <div class="evento-form-row">
        <label for="evento-form-categoria">Categoría</label>
        <select id="evento-form-categoria">${catOptions}</select>
      </div>
      <div class="evento-form-row">
        <label for="evento-form-fecha">Fecha</label>
        <input type="date" id="evento-form-fecha" value="${fechaValor}">
      </div>
      <div class="evento-form-row">
        <label class="evento-form-check"><input type="checkbox" id="evento-form-recurrente" ${eventoExistente && eventoExistente.recurrente ? 'checked' : ''}> Se repite cada año en esta misma fecha</label>
      </div>
      <div class="evento-form-row">
        <label>% de alza/baja esperado por sucursal (opcional)</label>
        <div class="evento-form-sucursales">
          ${STATE.sucursales.map(suc => `
            <div class="evento-form-suc-row">
              <span class="evento-form-suc-label">${sucDot(suc)}${suc}</span>
              <input type="number" step="0.1" class="evento-form-suc-input"
                     data-suc="${suc}" placeholder="Ej. 15 o -10"
                     value="${eventoExistente?.porSucursal?.[suc] ?? ''}">
            </div>
          `).join('')}
        </div>
        <p class="text-muted" style="font-size:.72rem;margin-top:.2rem">
          Deja en blanco las sucursales de las que no tengas estimado todavía.
        </p>
      </div>
      <div class="evento-form-row">
        <label for="evento-form-notas">Notas (opcional)</label>
        <textarea id="evento-form-notas" rows="2" maxlength="200">${eventoExistente ? (eventoExistente.notas || '') : ''}</textarea>
      </div>
      <div class="evento-form-actions">
        <div>${esEdicion ? `<button class="btn-mini" id="evento-form-borrar">🗑 Borrar evento</button>` : ''}</div>
        <button class="evento-form-guardar-btn" id="evento-form-guardar" type="button">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) cerrarFormularioEvento(); });
  document.getElementById('evento-form-close').addEventListener('click', cerrarFormularioEvento);

  document.getElementById('evento-form-borrar')?.addEventListener('click', () => {
    if (confirm('¿Borrar este evento personalizado?')) {
      DataEngine.eliminarEventoPersonalizado(eventoExistente.id);
      cerrarFormularioEvento();
      renderAll();
    }
  });

  document.getElementById('evento-form-guardar').addEventListener('click', () => {
    const nombre = document.getElementById('evento-form-nombre').value.trim();
    const fecha = document.getElementById('evento-form-fecha').value;
    const errorEl = document.getElementById('evento-form-error');
    if (!nombre || !fecha) {
      errorEl.textContent = 'Ponle un nombre y una fecha al evento antes de guardar.';
      errorEl.classList.add('visible');
      return;
    }
    const porSucursal = {};
    document.querySelectorAll('.evento-form-suc-input').forEach(inp => {
      porSucursal[inp.dataset.suc] = inp.value;
    });
    const datos = {
      nombre,
      categoria: document.getElementById('evento-form-categoria').value,
      fecha,
      recurrente: document.getElementById('evento-form-recurrente').checked,
      porSucursal,
      notas: document.getElementById('evento-form-notas').value.trim(),
    };
    if (esEdicion) DataEngine.eliminarEventoPersonalizado(eventoExistente.id); // simplifica: editar = borrar + crear de nuevo
    DataEngine.crearEventoPersonalizado(datos);
    cerrarFormularioEvento();
    renderAll();
    switchModule('eventos');
  });
}

/* ---------------- Método de proyección / filtro de sucursal ---------------- */

function renderMethodPills() {
  const select = document.getElementById('method-select');
  select.innerHTML = METODOS.map(m => `
    <option value="${m.key}" ${m.key === METODO_ACTUAL ? 'selected' : ''}>${m.label}</option>
  `).join('');
  const helpSlot = document.getElementById('method-help-slot');
  if (helpSlot) helpSlot.innerHTML = helpHint('Cada método calcula la proyección de forma distinta (promedio simple, tendencia, ignorando semanas raras, o una mezcla). El texto debajo del selector explica el que tenés elegido ahora.');
  select.onchange = () => {
    METODO_ACTUAL = select.value;
    actualizarDescripcionMetodo();
    renderAll();
  };
  actualizarDescripcionMetodo();
}

function actualizarDescripcionMetodo() {
  const desc = document.getElementById('method-desc');
  if (desc) desc.textContent = DataEngine.descripcionMetodo(METODO_ACTUAL);
}

/* ---------------- Pestañas de sucursal (módulo Sucursales) ---------------- */

function renderBranchTabs() {
  const wrap = document.getElementById('branch-tabs');
  if (!wrap) return;

  const filas = DataEngine.todasLasFilas(STATE, METODO_ACTUAL);
  const olvidosAll = DataEngine.alertasOlvido(STATE);

  const tabs = ['todas', ...STATE.sucursales];
  wrap.innerHTML = tabs.map(t => {
    if (t === 'todas') {
      return `<button class="branch-tab ${t === FILTRO_SUCURSAL ? 'active' : ''}" data-suc="${t}">Todas</button>`;
    }
    const fs = filas.filter(f => f.sucursal === t);
    const ol = olvidosAll.filter(o => o.sucursal === t);
    const crit = fs.filter(f => f.status === 'crit' && f.enOrden !== false).length + ol.length;
    const warn = fs.filter(f => f.status === 'warn').length;
    const unknown = fs.filter(f => f.status === 'unknown').length;
    let color = 'green';
    if (crit > 0) color = 'red';
    else if (warn > 0 || unknown > 0) color = 'blue';
    return `<button class="branch-tab ${t === FILTRO_SUCURSAL ? 'active' : ''}" data-suc="${t}"><span class="status-light-sm ${color}"></span>${t}</button>`;
  }).join('');

  wrap.querySelectorAll('.branch-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.suc === FILTRO_SUCURSAL) return;
      FILTRO_SUCURSAL = btn.dataset.suc;
      renderAll();
    });
  });
}

function filasFiltradas() {
  let filas = DataEngine.todasLasFilas(STATE, METODO_ACTUAL);
  if (FILTRO_SUCURSAL !== 'todas') filas = filas.filter(f => f.sucursal === FILTRO_SUCURSAL);
  return filas;
}

/* ---------------- Construcción de tarjetas de alerta (reutilizable) ---------------- */

function construirAlertCards(sucursalFiltro) {
  // Los ingredientes que la sucursal nunca puso en su orden (enOrden=false) ya están
  // cubiertos por la tarjeta "POSIBLE OLVIDO" de abajo — no los repetimos aquí como
  // si fuera "pidiendo 0", que es confuso (no es que pidieron 0, es que ni aparecieron).
  let filas = DataEngine.todasLasFilas(STATE, METODO_ACTUAL).filter(f => f.status !== 'ok' && f.enOrden !== false);
  let olvidos = DataEngine.alertasOlvido(STATE);
  if (sucursalFiltro && sucursalFiltro !== 'todas') {
    filas = filas.filter(f => f.sucursal === sucursalFiltro);
    olvidos = olvidos.filter(o => o.sucursal === sucursalFiltro);
  }

  const cards = [];

  filas.forEach(f => {
    if (f.status === 'crit') {
      cards.push({
        cls: 'crit', tag: 'SE PUEDE QUEDAR SIN STOCK', orden: 0,
        msg: `<b>${f.sucursal}</b> está pidiendo <b>${round1(f.pedidoBase)} ${f.unidad}</b> de <b>${f.nombre}</b>,
              pero se proyecta que necesitará <b>${round1(f.proyeccion)} ${f.unidad}</b> (ya tiene ${round1(f.stock)} en stock).
              Faltan aprox. <b>${round1(Math.abs(f.diferencia))} ${f.unidad}</b>.`,
        accion: DataEngine.accionSugerida(f),
      });
    } else if (f.status === 'warn') {
      cards.push({
        cls: 'warn', tag: f.perecedero ? 'SOBRE-PEDIDO · VENCE RÁPIDO' : 'SOBRE-PEDIDO', orden: 2,
        msg: `<b>${f.sucursal}</b> está pidiendo <b>${round1(f.diferencia)} ${f.unidad}</b> más de <b>${f.nombre}</b>
              de lo que proyectamos que necesita.${f.perecedero ? ' Al vencer rápido, hay riesgo real de que se dañe.' : ''}`,
        accion: DataEngine.accionSugerida(f),
      });
    } else if (f.status === 'unknown') {
      cards.push({
        cls: 'unknown', tag: 'INGREDIENTE DESCONOCIDO', orden: 3,
        msg: `<b>${f.sucursal}</b> pidió <b>${f.pedido} unidades</b> de "<b>${f.ingId}</b>", un ingrediente que
              no existe en el catálogo. No se puede convertir a unidad base ni evaluar si la cantidad es correcta.`,
        accion: DataEngine.accionSugerida(f),
      });
    }
  });

  olvidos.forEach(o => {
    cards.push({
      cls: 'crit', tag: 'POSIBLE OLVIDO', orden: 1,
      msg: `<b>${o.sucursal}</b> normalmente consume <b>${round1(o.consumoPromedio)} unidades/semana</b> de
            <b>${o.nombre}</b>, pero esta semana <b>no aparece en su orden</b>.`,
      accion: DataEngine.accionSugeridaOlvido(o),
    });
  });

  return cards.sort((a, b) => a.orden - b.orden);
}

function alertCardHTML(c, i) {
  return `
    <div class="alert-card ${c.cls}" style="animation-delay:${i * 0.02}s">
      <div class="alert-top"><span class="alert-tag">${c.tag}</span></div>
      <div class="alert-msg">${c.msg}</div>
      ${c.accion ? `<div class="accion-sugerida">→ ${c.accion}</div>` : ''}
    </div>
  `;
}

/* ---------------- Módulo Sucursales: tabla editable + consolidado ---------------- */

function analisisTexto(f) {
  const accion = f.status !== 'ok' ? `<div class="accion-sugerida">→ ${DataEngine.accionSugerida(f)}</div>` : '';
  if (f.status === 'unknown') {
    return `No está en el catálogo — no se puede evaluar.${accion}`;
  }
  const u = f.unidad || '';
  if (f.enOrden === false) {
    // Nunca apareció en la orden de esta semana (posible olvido) — no es que "pidieron 0".
    return `<b>No aparece en la orden de esta semana.</b> Normalmente se necesitan ~${round1(f.proyeccion)} ${u} — agrega una cantidad aquí si fue un olvido.`;
  }
  if (f.necesidad <= 0) {
    return `Ya tiene stock de sobra (${round1(f.stock)} ${u}) para lo proyectado (${round1(f.proyeccion)} ${u}).`;
  }
  if (f.status === 'crit') {
    return `Necesita ${round1(f.proyeccion)} ${u}, tiene ${round1(f.stock)} ${u} → faltan <b>${round1(Math.abs(f.diferencia))} ${u}</b> por pedir.${accion}`;
  }
  if (f.status === 'warn') {
    return `Necesita ${round1(f.proyeccion)} ${u}, tiene ${round1(f.stock)} ${u} → está pidiendo <b>${round1(f.diferencia)} ${u} de más</b>.${accion}`;
  }
  return `Necesita ${round1(f.proyeccion)} ${u}, tiene ${round1(f.stock)} ${u} → el pedido está bien ajustado.`;
}

function estadoLabel(f) {
  if (f.status === 'crit' && f.enOrden === false) return 'Olvidado (no está en la orden)';
  if (f.status === 'crit') return 'Se puede quedar sin stock';
  if (f.status === 'warn') return f.perecedero ? 'Sobre-pedido (vence rápido)' : 'Sobre-pedido';
  if (f.status === 'unknown') return 'No catalogado';
  return 'Correcto';
}

const GRUPOS_ORDENES = [
  { key: 'crit', icon: '🔴', label: 'Se puede quedar sin stock', match: f => f.status === 'crit' && f.enOrden !== false },
  { key: 'olvido', icon: '🟣', label: 'Nunca se pidió (posible olvido)', match: f => f.status === 'crit' && f.enOrden === false },
  { key: 'warn', icon: '🔵', label: 'Sobre-pedido', match: f => f.status === 'warn' },
  { key: 'unknown', icon: '⚪', label: 'No catalogado', match: f => f.status === 'unknown' },
  { key: 'ok', icon: '🟢', label: 'Correctas', match: f => f.status === 'ok' },
];

function renderSucursales() {
  if (!STATE || !document.getElementById('module-sucursales')) return;
  renderBranchTabs();
  renderOrdersTable();
  renderConsolidado();

  const countEl = document.getElementById('sucursales-alerts-count');
  if (countEl) countEl.textContent = construirAlertCards('todas').length;
}

function renderOrdersTable() {
  const todas = filasFiltradas();
  const container = document.getElementById('branch-orders-groups');

  // Dentro de cada grupo, lo recién tocado sube primero (más reciente arriba) para que
  // la gerente vaya viendo lo que ya ajustó sin tener que rebuscarlo alfabéticamente.
  const ordenarConEditadosArriba = (a, b) => {
    const ta = ULTIMA_EDICION[a.sucursal + '|' + a.ingId] || 0;
    const tb = ULTIMA_EDICION[b.sucursal + '|' + b.ingId] || 0;
    if (ta || tb) return tb - ta;
    return a.sucursal.localeCompare(b.sucursal) || a.nombre.localeCompare(b.nombre);
  };
  const grupos = GRUPOS_ORDENES
    .map(g => ({ ...g, filas: todas.filter(g.match).sort(ordenarConEditadosArriba) }))
    .filter(g => g.filas.length > 0);

  if (!grupos.length) {
    container.innerHTML = `<p class="text-muted" style="padding:1rem 0">No hay filas que mostrar con este filtro.</p>`;
    return;
  }

  container.innerHTML = grupos.map(g => {
    const abierto = ORDENES_GRUPO_ABIERTO[g.key];
    return `
      <div class="orders-group ${g.key}">
        <button class="orders-group-head" data-key="${g.key}" aria-expanded="${abierto}">
          <span class="orders-group-left">
            <span class="orders-group-chevron ${abierto ? 'open' : ''}">▸</span>
            <span class="orders-group-icon">${g.icon}</span>
            <span class="orders-group-label">${g.label}</span>
          </span>
          <span class="orders-group-count">${g.filas.length}</span>
        </button>
        <div class="orders-group-body ${abierto ? 'open' : ''}">
          <div class="table-wrap">
            <table class="orders-table">
              <thead>
                <tr><th></th><th>Sucursal / Ingrediente</th><th>Análisis</th><th>Pedido (formatos)</th><th>Estado</th></tr>
              </thead>
              <tbody>
                ${g.filas.map(f => `
                  <tr data-suc="${f.sucursal}" data-ing="${f.ingId}" class="${f.factor ? 'clickable-row' : ''} ${FILA_RECIEN_EDITADA === (f.sucursal + '|' + f.ingId) ? 'row-flash' : ''}"
                      title="${f.factor ? 'Clic para ver la tendencia de 6 semanas' : ''}">
                    <td><span class="status-dot ${f.status}"></span></td>
                    <td>
                      <div class="suc-label">${sucDot(f.sucursal)}${f.sucursal}${ULTIMA_EDICION[f.sucursal + '|' + f.ingId] ? '<span class="edited-badge">✎ editado</span>' : ''}</div>
                      <div class="text-muted" style="font-size:.78rem">${f.nombre}${f.perecedero ? ' <span class="perecedero-flag">● vence rápido</span>' : ''} · ${f.proveedor || 'sin proveedor'}</div>
                    </td>
                    <td style="max-width:320px">${analisisTexto(f)}</td>
                    <td>
                      <input type="number" min="0" class="qty-input" value="${f.pedido}"
                        data-suc="${f.sucursal}" data-ing="${f.ingId}" ${!f.factor ? 'disabled' : ''} />
                      <div class="text-muted" style="font-size:.65rem;margin-top:.2rem">${f.formato || ''}${f.pedidoBase != null ? ' = ' + round1(f.pedidoBase) + ' ' + (f.unidad || '') : ''}</div>
                    </td>
                    <td><span class="estado-tag ${f.status}">${estadoLabel(f)}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.orders-group-head').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      ORDENES_GRUPO_ABIERTO[key] = !ORDENES_GRUPO_ABIERTO[key];
      renderOrdersTable();
    });
  });

  container.querySelectorAll('.qty-input').forEach(input => {
    input.addEventListener('click', (e) => e.stopPropagation()); // no abrir el gráfico al hacer clic en el input
    input.addEventListener('change', (e) => {
      const suc = e.target.dataset.suc;
      const ing = e.target.dataset.ing;
      const val = Number(e.target.value) || 0;
      const estabaMal = DataEngine.evaluarFila(STATE, suc, ing, METODO_ACTUAL).status !== 'ok';

      STATE.ordenes[suc] = STATE.ordenes[suc] || {};
      STATE.ordenes[suc][ing] = val;

      const clave = suc + '|' + ing;
      ULTIMA_EDICION[clave] = Date.now();
      FILA_RECIEN_EDITADA = clave;

      const quedoOk = DataEngine.evaluarFila(STATE, suc, ing, METODO_ACTUAL).status === 'ok';
      if (estabaMal && quedoOk && !ORDENES_GRUPO_ABIERTO.ok) {
        mostrarToast('✓ Corregido — se movió al grupo "Correctas" (colapsado por defecto). Ábrelo para verlo.');
      }

      renderAll(); // recalcula todo en vivo
      // El pulso de "row-flash" solo debe verse una vez, no en cada re-render posterior.
      setTimeout(() => { if (FILA_RECIEN_EDITADA === clave) FILA_RECIEN_EDITADA = null; }, 50);
    });
  });

  container.querySelectorAll('tr.clickable-row').forEach(row => {
    row.addEventListener('click', () => mostrarTendencia(row.dataset.suc, row.dataset.ing));
  });
}

/* ---------------- Panel "Pedido consolidado" (suma entre las 4 sucursales) ---------------- */
//
// Independiente de la pestaña de sucursal activa (FILTRO_SUCURSAL): siempre muestra el
// total de las 4, para que sirva de acumulador mientras la gerente revisa sucursal por
// sucursal — así arma el pedido completo sin tener que ir y volver entre pestañas.
function renderConsolidado() {
  const cont = document.getElementById('consolidado-list');
  if (!cont) return;

  const helpSlot = document.getElementById('consolidado-help-slot');
  if (helpSlot && !helpSlot.dataset.wired) {
    helpSlot.innerHTML = helpHint('Suma, por ingrediente, lo pedido en las 4 sucursales (ya convertido a unidad base). Los "no catalogados" no se pueden sumar porque no tienen factor de conversión.')
      + colorLegendButton();
    helpSlot.dataset.wired = '1';
  }

  const filas = DataEngine.todasLasFilas(STATE, METODO_ACTUAL).filter(f => f.status !== 'unknown');
  const olvidos = DataEngine.alertasOlvido(STATE);

  // Orden de prioridad para decidir el color del TOTAL cuando mezcla sucursales con distinto estado:
  // si al menos una sucursal está en riesgo real, el total se pinta de rojo; si no, el peor de los demás.
  const PRIORIDAD = { olvido: 4, crit: 3, warn: 2, ok: 1 };

  const mapa = {}; // ingId -> { nombre, unidad, total, detalle: [{sucursal, valor, olvido, status}] }
  filas.forEach(f => {
    if (f.enOrden === false) return; // se agregan aparte abajo, marcados como "olvidado"
    mapa[f.ingId] = mapa[f.ingId] || { nombre: f.nombre, unidad: f.unidad, total: 0, detalle: [] };
    mapa[f.ingId].total += f.pedidoBase || 0;
    mapa[f.ingId].detalle.push({ sucursal: f.sucursal, valor: f.pedidoBase || 0, status: f.status });
  });
  olvidos.forEach(o => {
    const cat = STATE.catalogo[o.ingId];
    mapa[o.ingId] = mapa[o.ingId] || { nombre: o.nombre, unidad: cat ? cat.unidad_base : '', total: 0, detalle: [] };
    mapa[o.ingId].detalle.push({ sucursal: o.sucursal, valor: 0, olvido: true, status: 'olvido' });
  });

  const items = Object.values(mapa).sort((a, b) => a.nombre.localeCompare(b.nombre));
  if (!items.length) {
    cont.innerHTML = `<p class="text-muted" style="padding:.5rem 0;font-size:.8rem">Sin ingredientes que consolidar.</p>`;
    return;
  }

  cont.innerHTML = items.map(it => {
    const peorStatus = it.detalle.reduce((peor, d) => (PRIORIDAD[d.status] || 0) > (PRIORIDAD[peor] || 0) ? d.status : peor, 'ok');
    const chips = it.detalle.map(d => `
      <span class="cons-branch-chip ${d.olvido ? 'olvido' : ''}">
        ${sucDot(d.sucursal)}${d.sucursal}
        <span class="status-dot ${d.status}"></span>
        ${d.olvido ? 'olvidado' : `${round1(d.valor)}${it.unidad ? ' ' + it.unidad : ''}`}
      </span>
    `).join('');
    return `
      <div class="cons-item">
        <div class="cons-item-row"><span>${it.nombre}</span><span class="cons-item-qty st-${peorStatus}">${round1(it.total)} ${it.unidad || ''}</span></div>
        <div class="cons-item-breakdown">${chips}</div>
      </div>
    `;
  }).join('');
}

/* ---------------- Módulo Proveedores ---------------- */

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
    const sucursalesInvolucradas = new Set();
    Object.values(items).forEach(it => it.detalle.forEach(d => sucursalesInvolucradas.add(d.sucursal)));

    const filas = Object.values(items).map(it => {
      const detalle = it.detalle
        .sort((a, b) => b.formatos - a.formatos)
        .map(d => `<span class="provider-detalle-chip">${sucDot(d.sucursal)}${d.sucursal}: <b>${d.formatos}</b></span>`)
        .join('');
      return `
        <div class="provider-item">
          <div class="provider-item-top">
            <span>${it.nombre}</span>
            <span>Comprar <b>${it.total}</b> × <span class="text-muted">${it.formato}</span></span>
          </div>
          <div class="provider-detalle">${detalle}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="provider-block">
        <div class="provider-head">
          <span class="provider-name">${prov}</span>
          <div class="provider-head-right">
            <span class="text-muted">${Object.keys(items).length} ítem(s) · ${sucursalesInvolucradas.size} sucursal${sucursalesInvolucradas.size === 1 ? '' : 'es'}</span>
            <div class="provider-actions">
              <button class="btn-mini" data-pdf-prov="${prov}" title="Descargar PDF de este pedido">📄 PDF</button>
              <button class="btn-mini" data-copy-prov="${prov}" title="Copiar texto para WhatsApp/email">📋 Copiar</button>
            </div>
          </div>
        </div>
        <div class="provider-items">${filas}</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-pdf-prov]').forEach(btn => {
    btn.addEventListener('click', () => exportarPDF(btn.dataset.pdfProv));
  });
  container.querySelectorAll('[data-copy-prov]').forEach(btn => {
    btn.addEventListener('click', () => copiarPedidoProveedor(btn.dataset.copyProv));
  });
}

/* ---------------- Módulo Informes ---------------- */

function renderInformes() {
  if (!STATE || !document.getElementById('module-informes')) return;
  renderSummaryBarInto('informes-summary-bar');
  const exportHelpSlot = document.getElementById('export-help-slot');
  if (exportHelpSlot && !exportHelpSlot.dataset.wired) {
    exportHelpSlot.innerHTML = helpHint('Excel simple: una tabla por proveedor, en una sola hoja, para abrir rápido en cualquier planilla. Excel completo: varias hojas (Resumen, Todas las alertas, y una por proveedor), ideal para revisar todo junto antes de enviar. PDF: listo para imprimir o enviar por WhatsApp/correo. Cada tabla de abajo (Ajustes, Todos los pedidos, Historial de consumo) tiene además su propio botón de exportar CSV, ya con el filtro que le tengas puesto.');
    exportHelpSlot.dataset.wired = '1';
  }
  wireInformesFiltros();
  renderInformesEdiciones();
  renderInformesTablaCompleta();
  renderInformesHistorico();
}

// Compara la orden original (tal como llegó de las sucursales) contra STATE.ordenes
// (que se muta cada vez que la gerente edita una cantidad en el módulo "Sucursales"),
// para dejar un rastro claro de qué se corrigió y por cuánto.
function calcularEdicionesGerente() {
  const cambios = [];
  Object.keys(STATE.ordenes).forEach(suc => {
    const original = ORDENES_ORIGINALES[suc] || {};
    const actual = STATE.ordenes[suc] || {};
    const ids = new Set([...Object.keys(original), ...Object.keys(actual)]);
    ids.forEach(ingId => {
      const antes = typeof original[ingId] === 'number' ? original[ingId] : 0;
      const ahora = typeof actual[ingId] === 'number' ? actual[ingId] : 0;
      if (antes !== ahora) {
        const cat = STATE.catalogo[ingId];
        cambios.push({ sucursal: suc, nombre: cat ? cat.nombre : ingId, antes, ahora, diferencia: ahora - antes });
      }
    });
  });
  return cambios.sort((a, b) => a.sucursal.localeCompare(b.sucursal) || a.nombre.localeCompare(b.nombre));
}

function renderInformesEdiciones() {
  const cambios = calcularEdicionesGerente();
  const countEl = document.getElementById('informes-ediciones-count');
  if (countEl) countEl.textContent = cambios.length;
  const table = document.getElementById('informes-ediciones-table');
  if (!table) return;

  if (!cambios.length) {
    table.innerHTML = `<tbody><tr><td class="text-muted" style="padding:1rem 0">Aún no has editado ningún pedido en la pestaña "Sucursales". Cuando lo hagas, los cambios aparecerán aquí — sirve como bitácora de lo que corregiste antes de enviar a los proveedores.</td></tr></tbody>`;
    return;
  }

  table.innerHTML = `
    <thead><tr><th>Sucursal</th><th>Ingrediente</th><th>Pedido original</th><th>Pedido corregido</th><th>Diferencia</th></tr></thead>
    <tbody>
      ${cambios.map(c => `
        <tr>
          <td><span class="suc-label">${sucDot(c.sucursal)}${c.sucursal}</span></td>
          <td>${c.nombre}</td>
          <td>${round1(c.antes)}</td>
          <td>${round1(c.ahora)}</td>
          <td class="${c.diferencia > 0 ? 'diff-up' : 'diff-down'}">${c.diferencia > 0 ? '+' : ''}${round1(c.diferencia)}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
}

// Los selects de filtro de Informes se construyen una sola vez (sus opciones no
// cambian entre renders) para no perder la selección del usuario ni duplicar listeners.
function wireInformesFiltros() {
  const sucSel = document.getElementById('informes-sucursal-select');
  const provSel = document.getElementById('informes-proveedor-select');
  const estSel = document.getElementById('informes-estado-select');
  const semSel = document.getElementById('informes-semana-select');
  const sucHistSel = document.getElementById('informes-historico-sucursal-select');
  if (!sucSel || !provSel || !estSel || !semSel || !sucHistSel) return;

  if (!sucSel.dataset.wired) {
    sucSel.innerHTML = ['todas', ...STATE.sucursales].map(s => `<option value="${s}">${s === 'todas' ? 'Todas las sucursales' : s}</option>`).join('');
    sucSel.value = FILTRO_SUCURSAL_INFORMES;
    sucSel.addEventListener('change', () => {
      FILTRO_SUCURSAL_INFORMES = sucSel.value;
      renderInformesTablaCompleta();
    });
    sucSel.dataset.wired = '1';
  }

  if (!provSel.dataset.wired) {
    const proveedores = Array.from(new Set(Object.values(STATE.catalogo).map(c => c.proveedor).filter(Boolean))).sort();
    provSel.innerHTML = ['todos', ...proveedores].map(p => `<option value="${p}">${p === 'todos' ? 'Todos los proveedores' : p}</option>`).join('');
    provSel.value = FILTRO_PROVEEDOR_INFORMES;
    provSel.addEventListener('change', () => {
      FILTRO_PROVEEDOR_INFORMES = provSel.value;
      renderInformesTablaCompleta();
    });
    provSel.dataset.wired = '1';
  }

  const estHelpSlot = document.getElementById('informes-estado-help-slot');
  if (estHelpSlot && !estHelpSlot.dataset.wired) {
    estHelpSlot.innerHTML = helpHint('"Se puede quedar sin stock" es cuando la sucursal pidió, pero pidió de menos. "Olvidado" es cuando ni siquiera puso el ingrediente en la orden — son categorías distintas, no se mezclan.');
    estHelpSlot.dataset.wired = '1';
  }

  if (!estSel.dataset.wired) {
    estSel.value = FILTRO_ESTADO_INFORMES;
    estSel.addEventListener('change', () => {
      FILTRO_ESTADO_INFORMES = estSel.value;
      renderInformesTablaCompleta();
    });
    estSel.dataset.wired = '1';
  }

  // Filtro de sucursal PROPIO del panel "Historial de consumo" — a propósito no comparte
  // estado con el filtro de sucursal de "Todos los pedidos" de arriba, para poder mirar/
  // exportar el consumo de una sucursal específica sin afectar la otra tabla.
  if (!sucHistSel.dataset.wired) {
    sucHistSel.innerHTML = ['todas', ...STATE.sucursales].map(s => `<option value="${s}">${s === 'todas' ? 'Todas las sucursales' : s}</option>`).join('');
    sucHistSel.value = FILTRO_SUCURSAL_HISTORICO;
    sucHistSel.addEventListener('change', () => {
      FILTRO_SUCURSAL_HISTORICO = sucHistSel.value;
      renderInformesHistorico();
    });
    sucHistSel.dataset.wired = '1';
  }

  if (!semSel.dataset.wired) {
    semSel.innerHTML = DataEngine.WEEK_ORDER.map(w => `<option value="${w}">${w}</option>`).join('');
    semSel.value = SEMANA_INFORMES;
    semSel.addEventListener('change', () => {
      SEMANA_INFORMES = semSel.value;
      renderInformesHistorico();
    });
    semSel.dataset.wired = '1';
  }
}

function renderInformesTablaCompleta() {
  const table = document.getElementById('informes-full-table');
  if (!table) return;

  let filas = DataEngine.todasLasFilas(STATE, METODO_ACTUAL);
  if (FILTRO_SUCURSAL_INFORMES !== 'todas') filas = filas.filter(f => f.sucursal === FILTRO_SUCURSAL_INFORMES);
  if (FILTRO_PROVEEDOR_INFORMES !== 'todos') filas = filas.filter(f => f.proveedor === FILTRO_PROVEEDOR_INFORMES);
  if (FILTRO_ESTADO_INFORMES !== 'todas') {
    // Usa el mismo criterio que GRUPOS_ORDENES (Alertas) para que "crit" y "olvido"
    // no se mezclen: un ingrediente nunca puesto en la orden es "olvido", no "crit".
    const grupo = GRUPOS_ORDENES.find(g => g.key === FILTRO_ESTADO_INFORMES);
    filas = grupo ? filas.filter(grupo.match) : filas.filter(f => f.status === FILTRO_ESTADO_INFORMES);
  }
  filas = filas.slice().sort((a, b) => a.sucursal.localeCompare(b.sucursal) || a.nombre.localeCompare(b.nombre));

  if (!filas.length) {
    table.innerHTML = `<tbody><tr><td class="text-muted" style="padding:1rem 0">No hay pedidos que coincidan con este filtro.</td></tr></tbody>`;
    return;
  }

  table.innerHTML = `
    <thead><tr><th></th><th>Sucursal</th><th>Ingrediente</th><th>Proveedor</th><th>Pedido</th><th>Proyección</th><th>Stock</th><th>Estado</th></tr></thead>
    <tbody>
      ${filas.map(f => `
        <tr>
          <td><span class="status-dot ${f.status}"></span></td>
          <td><span class="suc-label">${sucDot(f.sucursal)}${f.sucursal}</span></td>
          <td>${f.nombre}</td>
          <td class="text-muted">${f.proveedor || '—'}</td>
          <td>${f.pedidoBase != null ? round1(f.pedidoBase) + ' ' + (f.unidad || '') : (f.pedido + ' (sin catálogo)')}</td>
          <td>${f.proyeccion != null ? round1(f.proyeccion) : '—'}</td>
          <td>${f.stock != null ? round1(f.stock) : '—'}</td>
          <td><span class="estado-tag ${f.status}">${estadoLabel(f)}</span></td>
        </tr>
      `).join('')}
    </tbody>
  `;
}

function renderInformesHistorico() {
  const table = document.getElementById('informes-historico-table');
  if (!table) return;
  const semana = SEMANA_INFORMES || DataEngine.WEEK_ORDER[DataEngine.WEEK_ORDER.length - 1];

  const filas = [];
  STATE.sucursales.forEach(suc => {
    if (FILTRO_SUCURSAL_HISTORICO !== 'todas' && suc !== FILTRO_SUCURSAL_HISTORICO) return;
    const consumo = STATE.consumoPorSucIng[suc] || {};
    Object.keys(consumo).forEach(ingId => {
      const valor = (consumo[ingId] || {})[semana];
      if (typeof valor !== 'number') return;
      const cat = STATE.catalogo[ingId];
      filas.push({ sucursal: suc, nombre: cat ? cat.nombre : ingId, unidad: cat ? cat.unidad_base : '', valor });
    });
  });
  filas.sort((a, b) => a.sucursal.localeCompare(b.sucursal) || a.nombre.localeCompare(b.nombre));

  if (!filas.length) {
    table.innerHTML = `<tbody><tr><td class="text-muted" style="padding:1rem 0">Sin datos de consumo para esta semana/filtro.</td></tr></tbody>`;
    return;
  }

  table.innerHTML = `
    <thead><tr><th>Sucursal</th><th>Ingrediente</th><th>Semana</th><th>Consumo</th></tr></thead>
    <tbody>
      ${filas.map(f => `<tr><td><span class="suc-label">${sucDot(f.sucursal)}${f.sucursal}</span></td><td>${f.nombre}</td><td>${semana}</td><td>${round1(f.valor)} ${f.unidad}</td></tr>`).join('')}
    </tbody>
  `;
}

/* ---------------- Módulo Anomalías ---------------- */

function renderAnomalies() {
  const anomalias = DataEngine.anomaliasEntreSucursales(STATE, METODO_ACTUAL);
  const container = document.getElementById('anomalies-container');
  const anomHelpSlot = document.getElementById('anomalias-help-slot');
  if (anomHelpSlot && !anomHelpSlot.dataset.wired) {
    anomHelpSlot.innerHTML = helpHint('Esto no mide si una sucursal pidió "correcto" o "incorrecto" contra su propia proyección — mide si pide muy distinto a las otras 3, lo cual puede ser normal (una sucursal más grande) o señal de un error.');
    anomHelpSlot.dataset.wired = '1';
  }

  if (!anomalias.length) {
    container.innerHTML = `<p class="text-muted">No se detectaron patrones de pedido inusuales entre sucursales.</p>`;
    return;
  }

  container.innerHTML = anomalias.slice(0, 10).map(a => {
    const masOMenos = a.ratio > a.promedioResto ? 'mucho más' : 'mucho menos';
    const vecesEsta = a.ratio === 0 ? 'nada' : `${round1(a.ratio)} veces lo que necesita`;
    const vecesResto = `${round1(a.promedioResto)} veces lo que necesitan`;
    return `
      <div class="anomaly-card">
        <b>${a.sucursal}</b> pidió ${masOMenos} <b>${a.nombre}</b> en proporción a lo que proyectamos que necesita,
        comparado con cómo piden las demás sucursales.
        <div class="anomaly-meta">Pidió ${vecesEsta}, mientras que el resto de sucursales pide en promedio ${vecesResto}.</div>
      </div>
    `;
  }).join('');
}

/* ---------------- Módulo Asistente IA ---------------- */

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
        // manual: texto fijo (js/system-manual.js) que describe módulos y botones,
        // para que el chat también pueda responder "cómo hago X en la página".
        body: JSON.stringify({ question, contexto, manual: SYSTEM_MANUAL }),
      });
      const data = await res.json();
      loadingEl.classList.remove('loading');
      loadingEl.textContent = data.answer || data.error || 'No pude generar una respuesta. Intenta de nuevo.';
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
