/* =========================================================
   DATA ENGINE — Barrio Pizza · Dashboard de Compras
   Toda la lógica de negocio vive aquí, separada de la UI.
   ========================================================= */

const DataEngine = (function () {

  const WEEK_ORDER = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
  const TOLERANCIA_FORMATOS = 1; // no se considera alerta si la diferencia es < 1 formato completo

  // ---------- Carga y parseo ----------

  async function loadCSV(path) {
    const filename = path.split('/').pop();
    let text;
    if (typeof window !== 'undefined' && window.EMBEDDED_CSV && window.EMBEDDED_CSV[filename]) {
      // Vista previa: los datos vienen embebidos en el HTML, sin necesidad de servidor.
      text = window.EMBEDDED_CSV[filename];
    } else {
      const res = await fetch(path);
      text = await res.text();
    }
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: true });
    return parsed.data;
  }

  async function loadAll() {
    const [ingredientesRaw, consumoRaw, inventarioRaw, ordenRaw] = await Promise.all([
      loadCSV('data/ingredientes.csv'),
      loadCSV('data/consumo_historico.csv'),
      loadCSV('data/inventario_actual.csv'),
      loadCSV('data/orden_compra_semana.csv'),
    ]);
    return build(ingredientesRaw, consumoRaw, inventarioRaw, ordenRaw);
  }

  // ---------- Construcción de estructuras indexadas ----------

  function build(ingredientesRaw, consumoRaw, inventarioRaw, ordenRaw) {
    const catalogo = {};
    ingredientesRaw.forEach(r => {
      if (!r.ingrediente_id) return;
      catalogo[r.ingrediente_id] = {
        id: r.ingrediente_id,
        nombre: r.nombre,
        proveedor: r.proveedor,
        unidad_base: r.unidad_base,
        formato_compra: r.formato_compra,
        factor: Number(r.unidad_base_por_formato),
        perecedero: String(r.es_perecedero).trim().toLowerCase() === 'si',
      };
    });

    const sucursales = new Set();
    const consumoPorSucIng = {}; // sucursal -> ingId -> {S1..S6}
    consumoRaw.forEach(r => {
      if (!r.sucursal) return;
      sucursales.add(r.sucursal);
      consumoPorSucIng[r.sucursal] = consumoPorSucIng[r.sucursal] || {};
      consumoPorSucIng[r.sucursal][r.ingrediente_id] = consumoPorSucIng[r.sucursal][r.ingrediente_id] || {};
      consumoPorSucIng[r.sucursal][r.ingrediente_id][r.semana] = Number(r.consumo_unidad_base);
    });

    const inventario = {}; // sucursal -> ingId -> stock
    inventarioRaw.forEach(r => {
      if (!r.sucursal) return;
      inventario[r.sucursal] = inventario[r.sucursal] || {};
      inventario[r.sucursal][r.ingrediente_id] = Number(r.stock_actual_unidad_base);
    });

    const ordenes = {}; // sucursal -> ingId -> cantidad_formatos
    ordenRaw.forEach(r => {
      if (!r.sucursal) return;
      sucursales.add(r.sucursal);
      ordenes[r.sucursal] = ordenes[r.sucursal] || {};
      ordenes[r.sucursal][r.ingrediente_id] = Number(r.cantidad_formatos);
    });

    return {
      catalogo,
      sucursales: Array.from(sucursales).sort(),
      consumoPorSucIng,
      inventario,
      ordenes, // esta copia se muta cuando el usuario edita cantidades en vivo
    };
  }

  // ---------- Estadística: proyección ----------

  function seriesFor(state, sucursal, ingId) {
    const obj = (state.consumoPorSucIng[sucursal] || {})[ingId] || {};
    return WEEK_ORDER.map(w => obj[w]).filter(v => typeof v === 'number' && !isNaN(v));
  }

  function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  // Regresión lineal simple: y = a + b*x, proyecta x = n+1
  function linearRegressionNext(arr) {
    const n = arr.length;
    if (n < 2) return mean(arr);
    const xs = arr.map((_, i) => i + 1);
    const xMean = mean(xs), yMean = mean(arr);
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - xMean) * (arr[i] - yMean);
      den += (xs[i] - xMean) ** 2;
    }
    const b = den === 0 ? 0 : num / den;
    const a = yMean - b * xMean;
    const proj = a + b * (n + 1);
    return Math.max(0, proj);
  }

  // Mediana + exclusión de outliers (IQR) sobre las semanas restantes
  function robustNext(arr) {
    if (arr.length < 4) return mean(arr);
    const s = [...arr].sort((a, b) => a - b);
    const q1 = s[Math.floor(s.length * 0.25)];
    const q3 = s[Math.ceil(s.length * 0.75) - 1];
    const iqr = q3 - q1;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;
    const filtered = arr.filter(v => v >= lower && v <= upper);
    return filtered.length ? mean(filtered) : median(arr);
  }

  function proyeccionesPara(state, sucursal, ingId) {
    const serie = seriesFor(state, sucursal, ingId);
    const promedio = mean(serie);
    const regresion = linearRegressionNext(serie);
    const robusta = robustNext(serie);
    const recomendada = (regresion + robusta) / 2; // combina tendencia + resistencia a atípicos
    return { serie, promedio, regresion, robusta, recomendada };
  }

  // ---------- Alertas por sucursal/ingrediente ----------

  function evaluarFila(state, sucursal, ingId, metodo) {
    const cat = state.catalogo[ingId];
    const proy = proyeccionesPara(state, sucursal, ingId);
    const proyeccion = proy[metodo] ?? proy.recomendada;
    const stock = ((state.inventario[sucursal] || {})[ingId]) ?? 0;
    const necesidad = proyeccion - stock; // puede ser negativo (ya cubierto)

    const cantidadFormatos = ((state.ordenes[sucursal] || {})[ingId]);
    const pedido = typeof cantidadFormatos === 'number' && !isNaN(cantidadFormatos) ? cantidadFormatos : 0;

    if (!cat) {
      // Ingrediente pedido pero no catalogado: no se puede convertir ni evaluar
      return {
        sucursal, ingId, nombre: ingId, proveedor: null, unidad: null,
        proyeccion, stock, necesidad, pedido, pedidoBase: null,
        diferencia: null, status: 'unknown', perecedero: false,
        motivo: 'no_catalogado',
      };
    }

    const pedidoBase = pedido * cat.factor;
    const diferencia = pedidoBase - necesidad;
    const toleranciaBase = TOLERANCIA_FORMATOS * cat.factor;

    let status = 'ok';
    let motivo = null;
    if (diferencia < -toleranciaBase) { status = 'crit'; motivo = 'bajo_pedido'; }
    else if (diferencia > toleranciaBase) { status = 'warn'; motivo = 'sobre_pedido'; }

    return {
      sucursal, ingId, nombre: cat.nombre, proveedor: cat.proveedor, unidad: cat.unidad_base,
      formato: cat.formato_compra, factor: cat.factor,
      proyeccion, stock, necesidad, pedido, pedidoBase, diferencia, status, motivo,
      perecedero: cat.perecedero,
    };
  }

  function todasLasFilas(state, metodo) {
    const filas = [];
    state.sucursales.forEach(suc => {
      // ingredientes pedidos (incluye los no catalogados)
      const idsPedidos = new Set(Object.keys(state.ordenes[suc] || {}));
      // ingredientes que la sucursal consume normalmente (histórico > 0) para detectar olvidos
      const idsConsumidos = new Set(Object.keys(state.consumoPorSucIng[suc] || {}));

      const idsTotales = new Set([...idsPedidos, ...idsConsumidos]);
      idsTotales.forEach(ingId => {
        filas.push(evaluarFila(state, suc, ingId, metodo));
      });
    });
    return filas;
  }

  // ---------- Alertas de "olvido" (no está en la orden) ----------

  function alertasOlvido(state) {
    const alertas = [];
    state.sucursales.forEach(suc => {
      const pedidos = state.ordenes[suc] || {};
      const consumo = state.consumoPorSucIng[suc] || {};
      Object.keys(consumo).forEach(ingId => {
        const serie = seriesFor(state, suc, ingId);
        const consumoPromedio = mean(serie);
        const estaEnOrden = Object.prototype.hasOwnProperty.call(pedidos, ingId);
        if (!estaEnOrden && consumoPromedio > 0) {
          const cat = state.catalogo[ingId];
          alertas.push({
            sucursal: suc, ingId, nombre: cat ? cat.nombre : ingId,
            proveedor: cat ? cat.proveedor : null,
            consumoPromedio,
            tipo: 'olvido',
          });
        }
      });
    });
    return alertas;
  }

  // ---------- Detección de anomalías entre sucursales ----------
  // Para cada ingrediente, compara pedido/proyección (ratio) de cada sucursal
  // contra el promedio de las demás. Si se desvía fuerte, se marca.

  function anomaliasEntreSucursales(state, metodo) {
    const catIds = Object.keys(state.catalogo);
    const anomalias = [];

    catIds.forEach(ingId => {
      const ratios = [];
      state.sucursales.forEach(suc => {
        const proy = proyeccionesPara(state, suc, ingId);
        const proyeccion = proy[metodo] ?? proy.recomendada;
        const pedido = ((state.ordenes[suc] || {})[ingId]) || 0;
        const cat = state.catalogo[ingId];
        const pedidoBase = pedido * cat.factor;
        if (proyeccion > 0.05) {
          ratios.push({ suc, ratio: pedidoBase / proyeccion });
        }
      });
      if (ratios.length < 3) return; // necesita al menos 3 sucursales comparables

      const vals = ratios.map(r => r.ratio);
      const m = mean(vals);
      const variance = mean(vals.map(v => (v - m) ** 2));
      const std = Math.sqrt(variance);
      if (std < 0.05) return; // todas piden proporcionalmente parecido, sin anomalía

      ratios.forEach(r => {
        const z = std > 0 ? (r.ratio - m) / std : 0;
        if (Math.abs(z) >= 1.4) {
          anomalias.push({
            sucursal: r.suc,
            ingId,
            nombre: state.catalogo[ingId].nombre,
            ratio: r.ratio,
            promedioResto: (m * ratios.length - r.ratio) / (ratios.length - 1),
            z,
          });
        }
      });
    });

    return anomalias.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  }

  // ---------- Pedido corregido agrupado por proveedor ----------

  function pedidoCorregidoPorProveedor(state, metodo) {
    const porProveedor = {};
    state.sucursales.forEach(suc => {
      Object.keys(state.catalogo).forEach(ingId => {
        const cat = state.catalogo[ingId];
        const proy = proyeccionesPara(state, suc, ingId);
        const proyeccion = proy[metodo] ?? proy.recomendada;
        const stock = ((state.inventario[suc] || {})[ingId]) ?? 0;
        const necesidad = proyeccion - stock;
        if (necesidad <= 0) return;
        const formatosRecomendados = Math.ceil(necesidad / cat.factor);
        if (formatosRecomendados <= 0) return;

        porProveedor[cat.proveedor] = porProveedor[cat.proveedor] || {};
        porProveedor[cat.proveedor][ingId] = porProveedor[cat.proveedor][ingId] || {
          nombre: cat.nombre, formato: cat.formato_compra, total: 0, detalle: [],
        };
        porProveedor[cat.proveedor][ingId].total += formatosRecomendados;
        porProveedor[cat.proveedor][ingId].detalle.push({ sucursal: suc, formatos: formatosRecomendados });
      });
    });
    return porProveedor;
  }

  // ---------- Resumen para el chat (contexto compacto, no CSVs crudos) ----------

  function resumenParaChat(state, metodo) {
    const filas = todasLasFilas(state, metodo).filter(f => f.status !== 'ok' || f.motivo);
    const olvidos = alertasOlvido(state);
    const anomalias = anomaliasEntreSucursales(state, metodo);

    return {
      metodo_proyeccion: metodo,
      alertas_bajo_pedido: filas.filter(f => f.status === 'crit').map(f => ({
        sucursal: f.sucursal, ingrediente: f.nombre, proyeccion: round2(f.proyeccion),
        pedido_base: round2(f.pedidoBase), necesidad: round2(f.necesidad), unidad: f.unidad,
      })),
      alertas_sobre_pedido: filas.filter(f => f.status === 'warn').map(f => ({
        sucursal: f.sucursal, ingrediente: f.nombre, proyeccion: round2(f.proyeccion),
        pedido_base: round2(f.pedidoBase), necesidad: round2(f.necesidad), unidad: f.unidad,
        perecedero: f.perecedero,
      })),
      ingredientes_no_catalogados: filas.filter(f => f.status === 'unknown').map(f => ({
        sucursal: f.sucursal, ingrediente_id: f.ingId,
      })),
      ingredientes_olvidados: olvidos.map(o => ({
        sucursal: o.sucursal, ingrediente: o.nombre, consumo_promedio_semanal: round2(o.consumoPromedio),
      })),
      anomalias_entre_sucursales: anomalias.slice(0, 15).map(a => ({
        sucursal: a.sucursal, ingrediente: a.nombre,
        ratio_pedido_vs_proyeccion: round2(a.ratio),
        promedio_resto_de_sucursales: round2(a.promedioResto),
      })),
    };
  }

  function round2(n) { return typeof n === 'number' ? Math.round(n * 100) / 100 : n; }

  return {
    loadAll, build, proyeccionesPara, evaluarFila, todasLasFilas,
    alertasOlvido, anomaliasEntreSucursales, pedidoCorregidoPorProveedor,
    resumenParaChat, seriesFor, WEEK_ORDER,
  };
})();
