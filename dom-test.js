/* =========================================================
   PRUEBA AUTOMATIZADA DE UI (jsdom) — sin servidor, sin red.
   Simula un navegador cargando index.html, inyecta los CSV embebidos,
   y ejercita todas las interacciones del dashboard antes de cada entrega.

   Nota técnica: los scripts se inyectan como <script> reales (no con
   dom.window.eval) porque `const`/`let` de nivel superior no quedan
   como propiedades de `window` al usar eval — sí lo hacen los <script>
   insertados en el documento, igual que en un navegador real.

   Chart.js / SheetJS(XLSX) / jsPDF se cargan por CDN en index.html, así
   que aquí van "stubeados" (versión mínima que solo registra la llamada)
   para poder probar el flujo sin conexión a internet. Esto prueba que
   nuestro código los llama correctamente — no prueba las librerías en sí.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const csvDir = path.join(process.cwd(), 'data');
const embedded = {};
['ingredientes.csv', 'consumo_historico.csv', 'inventario_actual.csv', 'orden_compra_semana.csv'].forEach(f => {
  embedded[f] = fs.readFileSync(path.join(csvDir, f), 'utf8');
});

let html = fs.readFileSync('index.html', 'utf8');
// Quitamos los <script src="..."> y el <link> de CSS: los locales los inyectamos
// nosotros a mano (para compartir el scope léxico correctamente) y los de CDN
// los reemplazamos por stubs, ya que este test corre sin red.
html = html
  .replace(/<script src="[^"]*"><\/script>\s*/g, '')
  .replace(/<link rel="stylesheet"[^>]*>\s*/g, '');

const dom = new JSDOM(html, { runScripts: 'dangerously', resources: undefined, url: 'http://localhost/' });
const { window } = dom;
const doc = window.document;

window.EMBEDDED_CSV = embedded;
window.Papa = require('papaparse');
window.fetch = async () => { throw new Error('no debería usarse fetch, hay EMBEDDED_CSV'); };
window.HTMLCanvasElement.prototype.getContext = () => ({}); // jsdom no implementa canvas 2d

// ---- Stubs de las libs de terceros (Chart.js / SheetJS / jsPDF) ----
window.Chart = function (ctx, cfg) { this.destroy = () => {}; this._cfg = cfg; };
window.XLSX = {
  utils: {
    book_new: () => ({ SheetNames: [], Sheets: {} }),
    aoa_to_sheet: (rows) => ({ rows }),
    book_append_sheet: (wb, ws, name) => { wb.SheetNames.push(name); wb.Sheets[name] = ws; },
  },
  writeFile: (wb, filename) => { console.log('  XLSX.writeFile ->', filename, '| hojas:', wb.SheetNames.join(', ')); },
};
window.jspdf = {
  jsPDF: function () {
    this.setFillColor = () => this; this.rect = () => this; this.setTextColor = () => this;
    this.setFont = () => this; this.setFontSize = () => this; this.text = () => this;
    this.internal = { pageSize: { getWidth: () => 612, getHeight: () => 792 } };
    this.addPage = () => this;
    this.autoTable = (cfg) => { this._lastTable = cfg; return this; };
    this.save = (filename) => { console.log('  jsPDF.save ->', filename); };
  },
};

const errors = [];
window.addEventListener('error', (e) => errors.push(e.error ? e.error.stack : e.message));

function injectScript(code) {
  const s = doc.createElement('script');
  s.textContent = code;
  doc.body.appendChild(s);
}

(async () => {
  injectScript(fs.readFileSync('js/data-engine.js', 'utf8'));
  injectScript(fs.readFileSync('js/app.js', 'utf8'));

  // app.js hace `document.addEventListener('DOMContentLoaded', init)`.
  // Como el documento ya está "loaded" en jsdom, disparamos el evento manualmente.
  doc.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));

  // init() es async — esperamos a que termine (carga datos + primer render)
  await new Promise(r => setTimeout(r, 500));

  if (errors.length) {
    console.error('❌ ERRORES CAPTURADOS AL CARGAR:\n', errors.join('\n---\n'));
    process.exit(1);
  }

  console.log('KPIs:', doc.getElementById('kpi-row').textContent.trim().replace(/\s+/g, ' '));
  console.log('Barra de resumen:', doc.getElementById('status-summary-bar').textContent.trim().replace(/\s+/g, ' '));
  console.log('\nAlerts count badge (módulo Sucursales):', doc.getElementById('sucursales-alerts-count').textContent);
  console.log('N filas en tabla (todos los grupos, incluye "correctas" colapsado):', doc.querySelectorAll('#branch-orders-groups tr').length);
  console.log('N grupos de órdenes renderizados:', doc.querySelectorAll('.orders-group').length);
  console.log('Grupo "olvido" (no está en la orden) existe:', !!doc.querySelector('.orders-group.olvido'));
  console.log('Grupo "ok" arranca colapsado:', !doc.querySelector('.orders-group.ok .orders-group-body')?.classList.contains('open'));

  // --- Regresión: un ingrediente que nunca se pidió no debe generar DOS alertas
  //     (una de "sin stock" con pedido=0 y otra de "olvido") — solo la de olvido.
  //     Se verifica sobre las tarjetas de "Lo más urgente" en Resumen, que usan
  //     construirAlertCards('todas') igual que antes usaba el módulo Alertas. ---
  console.log('Sin alertas "pidiendo 0" fantasma para ítems nunca pedidos:', !/pidiendo 0(?![.,\d])/.test(doc.getElementById('top-alert-list')?.textContent || ''));

  console.log('\nMethod select opciones:', doc.getElementById('method-select').innerHTML.replace(/\s+/g, ' '));
  console.log('Pestañas de sucursal (branch-tabs):', doc.getElementById('branch-tabs').textContent.trim().replace(/\s+/g, ' '));
  console.log('Panel "Pedido consolidado" tiene ítems:', doc.querySelectorAll('#consolidado-list .cons-item').length);

  // --- Gráfico de tendencia: clic en fila abre el modal, clic en la X lo cierra ---
  const row = doc.querySelector('#branch-orders-groups tr.clickable-row');
  console.log('\nHay fila clickeable con tendencia:', !!row);
  if (row) {
    row.dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    console.log('Modal de tendencia se abrió:', !!doc.getElementById('trend-modal'));
    doc.getElementById('trend-modal-close').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    console.log('Modal de tendencia se cerró con la X:', !doc.getElementById('trend-modal'));
  }

  // --- Clic en el input de cantidad NO debe abrir el modal (stopPropagation) ---
  const qtyInput = doc.querySelector('.qty-input');
  if (qtyInput) {
    qtyInput.dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    console.log('Clic en input de cantidad no abre el modal:', !doc.getElementById('trend-modal'));
  }

  // --- Exportar a Excel (multi-hoja) ---
  window.exportarExcel();
  await new Promise(r => setTimeout(r, 30));
  console.log('\nToast tras exportar Excel:', doc.getElementById('toast-msg') ? doc.getElementById('toast-msg').textContent : '(sin toast)');

  // --- Exportar a PDF por proveedor ---
  window.exportarPDF();
  await new Promise(r => setTimeout(r, 30));

  console.log('Botón "Excel (multi-hoja)" en Informes existe:', !!doc.getElementById('informes-export-excel'));
  console.log('Botón "PDF por proveedor" en Informes existe:', !!doc.getElementById('informes-export-pdf'));
  console.log('Botones de exportación generales ya NO están en el menú Opciones:',
    !doc.getElementById('opt-export-excel') && !doc.getElementById('opt-export-pdf') && !doc.getElementById('opt-export'));

  // --- Simular click para abrir el grupo "Correctas" (colapsado por defecto) ---
  const okHead = doc.querySelector('.orders-group.ok .orders-group-head');
  if (okHead) {
    okHead.dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    console.log('\nDespués de click en el grupo "Correctas" -> queda abierto:', doc.querySelector('.orders-group.ok .orders-group-body')?.classList.contains('open'));
  }

  // --- Pestañas de sucursal (módulo Sucursales): clic en una filtra la tabla y el consolidado sigue mostrando el total de las 4 ---
  const totalConsolidadoAntes = doc.querySelectorAll('#consolidado-list .cons-item').length;
  const branchTabBtn = doc.querySelector('.branch-tab:not(.active)');
  if (branchTabBtn) {
    const sucElegida = branchTabBtn.dataset.suc;
    branchTabBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    const filasSucSet = new Set(Array.from(doc.querySelectorAll('#branch-orders-groups tr[data-suc]')).map(r => r.dataset.suc));
    console.log('\nClic en pestaña de sucursal "' + sucElegida + '" -> tabla solo muestra esa sucursal:', filasSucSet.size === 1 && filasSucSet.has(sucElegida));
    console.log('Panel consolidado sigue mostrando el total de las 4 sucursales (no cambia con la pestaña):', doc.querySelectorAll('#consolidado-list .cons-item').length === totalConsolidadoAntes);
    // volvemos a "todas" para no afectar el resto del test
    doc.querySelector('.branch-tab[data-suc="todas"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
  }

  // --- Simular cambio de método de proyección ---
  const methodSelect = doc.getElementById('method-select');
  methodSelect.value = 'promedio';
  methodSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 50));
  console.log('\nDespués de cambiar a "promedio" -> KPIs:', doc.getElementById('kpi-row').textContent.trim().replace(/\s+/g, ' '));
  console.log('Barra de resumen sigue igual a los KPIs:', doc.getElementById('status-summary-bar').textContent.trim().replace(/\s+/g, ' '));

  // --- Simular edición de una cantidad pedida (probar que la edición en vivo no rompe nada) ---
  const firstInput = doc.querySelector('.qty-input');
  if (firstInput) {
    firstInput.value = '999';
    firstInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    console.log('\nDespués de editar una cantidad -> KPIs:', doc.getElementById('kpi-row').textContent.trim().replace(/\s+/g, ' '));
  }

  // --- Filtro "Estado" en Informes: "crit" (sin stock) y "olvido" ya no se mezclan ---
  window.switchModule('informes');
  await new Promise(r => setTimeout(r, 30));
  const estSel = doc.getElementById('informes-estado-select');
  console.log('\nOpciones del filtro Estado en Informes:', estSel.innerHTML.replace(/\s+/g, ' '));

  estSel.value = 'crit';
  estSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  const nFilasCritInformes = doc.querySelectorAll('#informes-full-table tbody tr').length;
  console.log('Filas con filtro "crit" (solo sin stock, sin olvidados):', nFilasCritInformes);

  estSel.value = 'olvido';
  estSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  const nFilasOlvidoInformes = doc.querySelectorAll('#informes-full-table tbody tr').length;
  console.log('Filas con filtro "olvido" (solo olvidados):', nFilasOlvidoInformes);
  console.log('El total "crit" + "olvido" separados no se superponen (esperado: 1 + 1 = 2):', nFilasCritInformes + nFilasOlvidoInformes === 2);

  estSel.value = 'todas';
  estSel.dispatchEvent(new window.Event('change', { bubbles: true }));

  // --- Iconos de ayuda (ⓘ): presentes y con texto ---
  console.log('\nHelp-hints renderizados en la página:', doc.querySelectorAll('.help-hint').length);
  const kpiHint = doc.querySelector('#kpi-row .help-hint .help-popover');
  console.log('Primer help-hint de KPI tiene texto:', !!(kpiHint && kpiHint.textContent.trim().length > 10));

  if (errors.length) {
    console.error('❌ ERRORES DURANTE INTERACCIÓN:\n', errors.join('\n---\n'));
    process.exit(1);
  }

  console.log('\n✅ TODO EL FLUJO DE UI CORRIÓ SIN ERRORES (incluye tendencia, Excel, PDF, barra de resumen, filtro Estado y help-hints)');
})().catch(err => {
  console.error('❌ ERROR:', err);
  process.exit(1);
});
