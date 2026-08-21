/* =========================================================
   DATA ENGINE — Barrio Pizza · Dashboard de Compras
   Toda la lógica de negocio vive aquí, separada de la UI.
   ========================================================= */

const DataEngine = (function () {

  const WEEK_ORDER = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
  const TOLERANCIA_FORMATOS = 1; // no se considera alerta si la diferencia es < 1 formato completo

  // ---------- Carga y parseo ----------

  async function loadCSV(path, opts) {
    const filename = path.split('/').pop();
    let text;
    if (typeof window !== 'undefined' && window.EMBEDDED_CSV && window.EMBEDDED_CSV[filename]) {
      // Vista previa: los datos vienen embebidos en el HTML, sin necesidad de servidor.
      text = window.EMBEDDED_CSV[filename];
    } else {
      const res = await fetch(path);
      text = await res.text();
    }
    const parsed = Papa.parse(text, Object.assign({ header: true, skipEmptyLines: true, dynamicTyping: true }, opts));
    return parsed.data;
  }

  async function loadAll() {
    const [ingredientesRaw, consumoRaw, inventarioRaw, ordenRaw, eventosRaw, ventasRefRaw] = await Promise.all([
      loadCSV('data/ingredientes.csv'),
      loadCSV('data/consumo_historico.csv'),
      loadCSV('data/inventario_actual.csv'),
      loadCSV('data/orden_compra_semana.csv'),
      // Estos dos llevan una primera línea "# DATOS SIMULADOS..." — comments:'#' hace
      // que Papa.parse la ignore en vez de tomarla como fila de encabezados.
      loadCSV('data/eventos_historicos.csv', { comments: '#' }),
      loadCSV('data/ventas_semanales_referencia.csv', { comments: '#' }),
    ]);
    return build(ingredientesRaw, consumoRaw, inventarioRaw, ordenRaw, eventosRaw, ventasRefRaw);
  }

  // ---------- Construcción de estructuras indexadas ----------

  function build(ingredientesRaw, consumoRaw, inventarioRaw, ordenRaw, eventosRaw, ventasRefRaw) {
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
      eventos: buildEventos(eventosRaw || []),
      ventasReferencia: buildVentasReferencia(ventasRefRaw || []),
    };
  }

  // ---------- Eventos (data sintética de referencia — ver notas en los CSV) ----------
  //
  // Agrupa las filas de eventos_historicos.csv (una por sucursal) en un catálogo de
  // eventos único, con el alza histórica observada por sucursal y el promedio general.
  // Esto es lo que usa el módulo "Eventos" para armar el calendario y para sugerir
  // un % cuando la gerente crea un evento futuro parecido, en vez de que alguien
  // invente el número a ojo.
  function buildEventos(eventosRaw) {
    const porNombre = {};
    eventosRaw.forEach(r => {
      if (!r || !r.nombre_evento || !r.fecha) return;
      const key = r.nombre_evento;
      porNombre[key] = porNombre[key] || {
        nombre: key, categoria: r.categoria, fecha: r.fecha, porSucursal: {}, alzas: [],
      };
      const alza = Number(r.alza_pct_observada);
      porNombre[key].porSucursal[r.sucursal] = alza;
      if (!isNaN(alza)) porNombre[key].alzas.push(alza);
    });

    return Object.values(porNombre).map(e => {
      const ordenadas = Object.entries(e.porSucursal).sort((a, b) => b[1] - a[1]);
      const masAfectada = ordenadas[0] || null;
      const menosAfectada = ordenadas[ordenadas.length - 1] || null;
      return {
        nombre: e.nombre,
        categoria: e.categoria,
        fecha: e.fecha, // fecha de referencia (año en que se simuló, se usa solo el mes/día)
        porSucursal: e.porSucursal,
        alzaPromedio: mean(e.alzas),
        sucursalMasAfectada: masAfectada ? masAfectada[0] : null,
        alzaMasAfectada: masAfectada ? masAfectada[1] : null,
        sucursalMenosAfectada: menosAfectada ? menosAfectada[0] : null,
        alzaMenosAfectada: menosAfectada ? menosAfectada[1] : null,
      };
    }).sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  function buildVentasReferencia(ventasRefRaw) {
    const porSucursal = {};
    ventasRefRaw.forEach(r => {
      if (!r || !r.sucursal) return;
      porSucursal[r.sucursal] = porSucursal[r.sucursal] || [];
      porSucursal[r.sucursal].push({
        semana: r.semana_num, fecha: r.fecha_lunes, indice: Number(r.indice_ventas), evento: r.evento || null,
      });
    });
    return porSucursal;
  }

  // ---------- Calendario de eventos: próxima ocurrencia y cuenta regresiva ----------
  //
  // Los eventos se guardaron con una fecha de referencia (el año en que se simuló la
  // data), pero son fechas que se repiten cada año (San Valentín, Independencia...).
  // Estas funciones toman el mes/día de esa fecha y calculan cuándo cae la PRÓXIMA
  // ocurrencia a partir de "hoy" (o de la fecha que se le pase), para poder avisar
  // con anticipación sin importar en qué año se esté ejecutando el dashboard.

  function proximaOcurrencia(fechaRef, desde) {
    const partes = String(fechaRef).split('-').map(Number);
    const mes = partes[1], dia = partes[2];
    const hoy = desde ? new Date(desde) : new Date();
    const hoy0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    let candidata = new Date(hoy0.getFullYear(), mes - 1, dia);
    if (candidata < hoy0) candidata = new Date(hoy0.getFullYear() + 1, mes - 1, dia);
    return candidata;
  }

  function diasHasta(fecha, desde) {
    const hoy = desde ? new Date(desde) : new Date();
    const hoy0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    const f0 = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    return Math.round((f0 - hoy0) / 86400000);
  }

  // Devuelve el catálogo completo de eventos, cada uno con su próxima fecha real y
  // los días que faltan, ordenado del más próximo al más lejano (para el calendario).
  function calendarioEventos(state, desde) {
    return (state.eventos || []).map(e => {
      const proximaFecha = proximaOcurrencia(e.fecha, desde);
      return Object.assign({}, e, { proximaFecha, diasFaltantes: diasHasta(proximaFecha, desde) });
    }).sort((a, b) => a.diasFaltantes - b.diasFaltantes);
  }

  // El evento (si hay alguno) que cae dentro de los próximos `diasVentana` días —
  // es lo que dispara el banner de aviso en el módulo Resumen.
  function eventoProximo(state, diasVentana, desde) {
    const cal = calendarioEventos(state, desde);
    return cal.find(e => e.diasFaltantes >= 0 && e.diasFaltantes <= diasVentana) || null;
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

    const enOrden = Object.prototype.hasOwnProperty.call(state.ordenes[sucursal] || {}, ingId);
    const cantidadFormatos = ((state.ordenes[sucursal] || {})[ingId]);
    const pedido = typeof cantidadFormatos === 'number' && !isNaN(cantidadFormatos) ? cantidadFormatos : 0;

    if (!cat) {
      // Ingrediente pedido pero no catalogado: no se puede convertir ni evaluar
      return {
        sucursal, ingId, nombre: ingId, proveedor: null, unidad: null,
        proyeccion, stock, necesidad, pedido, pedidoBase: null,
        diferencia: null, status: 'unknown', perecedero: false,
        motivo: 'no_catalogado', enOrden,
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
      perecedero: cat.perecedero, enOrden,
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
  //
  // Importante: esto SÍ depende de lo que quedó en state.ordenes (incluyendo las
  // ediciones en vivo que hace la gerente en el módulo "Órdenes"). La regla es:
  //   - Si la sucursal SÍ tiene el ingrediente en su orden: se manda lo que quedó
  //     en esa orden (ya editada/corregida), pero nunca menos de la necesidad real
  //     proyectada (así, si la gerente corrige un pedido bajo hasta que la fila se
  //     ponga "ok", el proveedor recibe exactamente esa cantidad corregida).
  //   - Si la sucursal NUNCA puso el ingrediente en su orden (posible olvido) pero
  //     sí lo consume normalmente: se recomienda la necesidad real proyectada,
  //     porque no hay ningún pedido del que partir.
  //   - Los ingredientes no catalogados se excluyen (no hay proveedor ni factor de
  //     conversión con el que armar una cantidad a comprar).
  function pedidoCorregidoPorProveedor(state, metodo) {
    const porProveedor = {};
    state.sucursales.forEach(suc => {
      const idsPedidos = new Set(Object.keys(state.ordenes[suc] || {}));
      const idsConsumidos = new Set(Object.keys(state.consumoPorSucIng[suc] || {}));
      const idsTotales = new Set([...idsPedidos, ...idsConsumidos]);

      idsTotales.forEach(ingId => {
        const cat = state.catalogo[ingId];
        if (!cat) return; // no catalogado: no se puede convertir ni asignar a un proveedor

        const proy = proyeccionesPara(state, suc, ingId);
        const proyeccion = proy[metodo] ?? proy.recomendada;
        const stock = ((state.inventario[suc] || {})[ingId]) ?? 0;
        const necesidad = proyeccion - stock;
        const formatosNecesarios = necesidad > 0 ? Math.ceil(necesidad / cat.factor) : 0;

        const enOrden = idsPedidos.has(ingId);
        let formatosAComprar;
        if (!enOrden) {
          formatosAComprar = formatosNecesarios;
        } else {
          const cantidadFormatos = Number((state.ordenes[suc] || {})[ingId]);
          const formatosPedidos = !isNaN(cantidadFormatos) && cantidadFormatos > 0 ? cantidadFormatos : 0;
          formatosAComprar = Math.max(formatosPedidos, formatosNecesarios);
        }
        if (formatosAComprar <= 0) return;

        porProveedor[cat.proveedor] = porProveedor[cat.proveedor] || {};
        porProveedor[cat.proveedor][ingId] = porProveedor[cat.proveedor][ingId] || {
          nombre: cat.nombre, formato: cat.formato_compra, total: 0, detalle: [],
        };
        porProveedor[cat.proveedor][ingId].total += formatosAComprar;
        porProveedor[cat.proveedor][ingId].detalle.push({ sucursal: suc, formatos: formatosAComprar });
      });
    });
    return porProveedor;
  }

  // ---------- Resumen para el chat (contexto compacto, no CSVs crudos) ----------
  //
  // Diseño: el chat recibe TODO lo que el sistema ya calculó — no solo alertas —
  // para poder responder cualquier pregunta sobre esta semana, no solo las que
  // anticipamos. Sigue sin recibir los CSVs crudos a propósito: si le mandáramos
  // las 528 filas de consumo sin procesar, el modelo tendría que sumar/promediar
  // él mismo, y eso es justo lo que queremos evitar (los cálculos ya están hechos
  // y verificados en JS; el modelo solo redacta). "Todo" significa todo lo
  // CALCULADO, no todo lo CRUDO.
  //
  // Límite real a tener en cuenta: la capa gratuita de Groq tiene un tope de
  // tokens por minuto bastante ajustado (varía por modelo, unos miles de tokens).
  // Como la API no tiene memoria entre preguntas, este bloque completo se manda
  // de nuevo en CADA pregunta del chat. Por eso se usa un formato compacto (sin
  // campos internos como "factor" o "motivo") en vez de mandar los objetos
  // completos tal cual los usa la UI.
  function resumenParaChat(state, metodo) {
    const filas = todasLasFilas(state, metodo).filter(f => f.status !== 'unknown');
    const noCatalogados = todasLasFilas(state, metodo).filter(f => f.status === 'unknown');
    const olvidos = alertasOlvido(state);
    const anomalias = anomaliasEntreSucursales(state, metodo);

    const catalogo_ingredientes = Object.values(state.catalogo || {}).map(c => ({
      ingrediente: c.nombre, proveedor: c.proveedor, unidad: c.unidad_base,
      formato_compra: c.formato_compra, perecedero: c.perecedero,
    }));
    const proveedores = [...new Set(catalogo_ingredientes.map(c => c.proveedor).filter(Boolean))];

    // Pedido de ESTA semana agrupado por proveedor (misma lógica que el módulo
    // "Proveedores"), para que el chat pueda responder "¿a qué proveedor le estoy
    // pidiendo más?" — distinto de historial de compras pasadas, que no se guarda.
    const porProveedorRaw = pedidoCorregidoPorProveedor(state, metodo);
    const pedido_actual_por_proveedor = Object.entries(porProveedorRaw).map(([proveedor, items]) => {
      const lineas = Object.values(items);
      return {
        proveedor,
        items_distintos: lineas.length,
        total_formatos_pedidos: lineas.reduce((sum, it) => sum + it.total, 0),
      };
    }).sort((a, b) => b.total_formatos_pedidos - a.total_formatos_pedidos);

    // TODAS las combinaciones sucursal-ingrediente catalogadas (incluidas las que
    // están "ok"), como tabla de texto agrupada por ingrediente en vez de JSON:
    // el mismo contenido en JSON ocupa ~3.6x más tokens porque repite los nombres
    // de cada campo en cada una de las ~90 filas. En texto plano, el modelo lo
    // interpreta igual de bien con una fracción del costo — importante porque la
    // capa gratuita de Groq tiene un tope de tokens por minuto y este bloque se
    // manda completo en CADA pregunta del chat (la API no tiene memoria propia).
    const porIngrediente = {};
    filas.forEach(f => {
      porIngrediente[f.nombre] = porIngrediente[f.nombre] || { proveedor: f.proveedor, unidad: f.unidad, lineas: [] };
      let linea = `${f.sucursal}: ${f.status}, proyección=${round2(f.proyeccion)}, stock=${round2(f.stock)}, pedido=${round2(f.pedidoBase)}, necesidad=${round2(f.necesidad)}`;
      if (f.status !== 'ok') linea += ` → ${accionSugerida(f)}`;
      porIngrediente[f.nombre].lineas.push(linea);
    });
    let tabla_pedidos_detalle = '';
    Object.entries(porIngrediente).forEach(([nombre, d]) => {
      tabla_pedidos_detalle += `${nombre} [proveedor: ${d.proveedor}, unidad: ${d.unidad}]\n`;
      d.lineas.forEach(l => { tabla_pedidos_detalle += `  ${l}\n`; });
    });

    return {
      metodo_proyeccion: metodo,
      proveedores,
      catalogo_ingredientes,
      pedido_actual_por_proveedor,
      // Tabla con TODOS los pedidos de esta semana (unidad-base, no formatos de
      // compra), agrupada por ingrediente. "estado" es ok / crit (falta stock) /
      // warn (sobra). Incluye la acción sugerida cuando no está "ok".
      tabla_pedidos_detalle,
      ingredientes_no_catalogados: noCatalogados.map(f => ({
        sucursal: f.sucursal, ingrediente_id: f.ingId,
      })),
      ingredientes_olvidados: olvidos.map(o => ({
        sucursal: o.sucursal, ingrediente: o.nombre, proveedor: o.proveedor, consumo_promedio_semanal: round2(o.consumoPromedio),
        accion_sugerida: accionSugeridaOlvido(o),
      })),
      anomalias_entre_sucursales: anomalias.map(a => ({
        sucursal: a.sucursal, ingrediente: a.nombre,
        ratio_pedido_vs_proyeccion: round2(a.ratio),
        promedio_resto_de_sucursales: round2(a.promedioResto),
      })),
      // Calendario de eventos (data sintética de referencia, ver módulo "Eventos"):
      // permite responder preguntas como "¿cuándo es el próximo evento?" o "¿cuánto
      // sube históricamente Halloween en Marbella?".
      proximos_eventos: calendarioEventos(state).slice(0, 6).map(e => ({
        evento: e.nombre, categoria: e.categoria, dias_faltantes: e.diasFaltantes,
        alza_historica_promedio_pct: round2(e.alzaPromedio),
        sucursal_mas_afectada: e.sucursalMasAfectada, alza_sucursal_mas_afectada_pct: round2(e.alzaMasAfectada),
      })),
    };
  }

  function round2(n) { return typeof n === 'number' ? Math.round(n * 100) / 100 : n; }

  // ---------- Acción sugerida (misma lógica para tarjetas, tabla, PDF, Excel y chat) ----------

  function accionSugerida(f) {
    if (!f) return '';
    if (f.status === 'unknown') {
      return 'Verificar con la sucursal qué producto es y agregarlo al catálogo.';
    }
    if (f.status === 'crit') {
      const formatosFaltantes = f.factor ? Math.ceil(Math.abs(f.diferencia) / f.factor) : null;
      const destino = f.proveedor ? ` a ${f.proveedor}` : '';
      return formatosFaltantes
        ? `Pedir ${formatosFaltantes} ${formatosFaltantes === 1 ? 'unidad más' : 'unidades más'} de "${f.formato}"${destino} antes de cerrar la orden.`
        : `Aumentar la cantidad pedida${destino} antes de cerrar la orden.`;
    }
    if (f.status === 'warn') {
      return f.perecedero
        ? 'Reducir la cantidad — al vencer rápido, el excedente probablemente se daña.'
        : 'Confirmar con la sucursal si el excedente se puede quedar en inventario o conviene bajar el pedido.';
    }
    return 'Ninguna — el pedido está bien ajustado a lo proyectado.';
  }

  function accionSugeridaOlvido(o) {
    const destino = o && o.proveedor ? ` (proveedor: ${o.proveedor})` : '';
    return `Confirmar con la sucursal si fue un olvido y agregarlo a la orden antes de enviarla${destino}.`;
  }

  const DESCRIPCION_METODOS = {
    promedio: 'Saca el promedio de las 6 semanas tal cual. Simple, pero si el consumo viene subiendo o bajando, no lo detecta.',
    regresion: 'Traza la tendencia de las 6 semanas y proyecta hacia dónde va. Útil si una sucursal está creciendo o cayendo en ventas.',
    robusta: 'Ignora semanas raras (una fiesta, un feriado) antes de promediar, para que un solo día extraño no distorsione la proyección.',
    recomendada: 'Combina la tendencia (regresión) con la resistencia a semanas raras (robusta). Es la que usamos por defecto para la mayoría de los casos.',
  };
  function descripcionMetodo(key) { return DESCRIPCION_METODOS[key] || ''; }

  return {
    loadAll, build, proyeccionesPara, evaluarFila, todasLasFilas,
    alertasOlvido, anomaliasEntreSucursales, pedidoCorregidoPorProveedor,
    resumenParaChat, seriesFor, WEEK_ORDER, accionSugerida, accionSugeridaOlvido,
    descripcionMetodo,
    calendarioEventos, eventoProximo, proximaOcurrencia, diasHasta,
  };
})();
