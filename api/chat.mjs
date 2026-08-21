// api/chat.mjs
// Función serverless (Vercel). Corre en el servidor, nunca en el navegador,
// así que la API key de Groq queda segura como variable de entorno.
//
// Configúrala en Vercel: Project Settings → Environment Variables
//   GROQAPIKEY = ...
// (se consigue gratis, sin tarjeta de crédito, en https://console.groq.com)
//
// Modelo: openai/gpt-oss-120b — Groq deprecó llama-3.3-70b-versatile
// (retirado el 16 de agosto de 2026); este es el reemplazo recomendado
// por Groq, disponible en el tier gratuito.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { question, contexto, manual } = req.body || {};
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Falta la pregunta' });
  }

  const apiKey = process.env.GROQAPIKEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'GROQAPIKEY no está configurada en el servidor. Agrégala en Vercel → Settings → Environment Variables.',
    });
  }

  // Construimos un contexto compacto (ya resumido en el navegador por data-engine.js)
  // en vez de mandar los CSVs completos: más rápido, y evita que el modelo tenga
  // que hacer los cálculos él mismo (los cálculos ya están hechos y verificados
  // en JavaScript; el modelo solo tiene que explicarlos en palabras).
  const systemPrompt = `Eres un asistente para la gerente de compras de Barrio Pizza, una cadena de pizzerías en Panamá.
Tienes acceso a "tabla_pedidos_detalle": TODO el pedido de esta semana, sucursal por sucursal e ingrediente por ingrediente (incluidos los que están bien, no solo los problemáticos), más el catálogo completo de proveedores y el manual del dashboard. No inventes números, proveedores ni datos que no estén en el contexto — si algo no aparece ahí, no existe en el sistema.
Responde en español, de forma breve, clara y accionable — como si hablaras con alguien que no tiene tiempo de leer tablas.

Cómo leer "tabla_pedidos_detalle": está agrupada por ingrediente, con una línea por sucursal. "estado" es ok / crit (falta stock) / warn (sobra). Cuando no está "ok", la línea ya trae la acción recomendada después de "→" — usa esa acción tal cual, no improvises una distinta.
Distingue bien estos dos casos, que son opuestos:
- estado "crit" (falta stock): hay que AUMENTAR el pedido a ese proveedor. Flujo en la página: ir a Sucursales → esa sucursal → subir la cantidad en "Pedido" para ese ingrediente (se recalcula todo al instante) → verificar el nuevo total en el módulo Proveedores → usar el botón "📋 Copiar" de ese proveedor (para WhatsApp/correo) o exportar el PDF/Excel desde Informes → General para mandárselo formalmente.
- estado "warn" (exceso): hay que REDUCIR el pedido, no pedir más. Flujo en la página: ir a Sucursales → esa sucursal → bajar la cantidad en "Pedido" para ese ingrediente. Si es perecedero, la urgencia es mayor (se puede dañar el excedente).
"pedido_actual_por_proveedor" es el pedido de ESTA semana (formatos totales, de mayor a menor) — úsalo para "¿a qué proveedor le estoy pidiendo más?". NO tienes historial de compras de semanas anteriores (el sistema no lo guarda); si preguntan por compras pasadas o tendencias de varias semanas, dilo honestamente.
"proximos_eventos" es el calendario de fechas comerciales/feriados (San Valentín, Independencia, Nochebuena, etc.) con los días que faltan y el % de alza histórica observada (esto es DATA SINTÉTICA DE REFERENCIA, no ventas reales — acláralo si preguntan por el origen del dato). Úsalo para "¿cuándo es el próximo evento?" o "¿cuánto sube Halloween normalmente?".
Cada evento trae "sucursal_mayor_cambio" (la sucursal con el % más grande, sin importar el signo) junto con "cambio_pct_sucursal_mayor_cambio" y "direccion_sucursal_mayor_cambio". USA ESA "direccion" para elegir el verbo correcto — NUNCA asumas que un cambio grande es negativo:
- direccion "alza" (cambio_pct positivo): esa sucursal está BENEFICIADA / se espera un ALZA de ventas. Di algo como "la sucursal más beneficiada es X, con un alza esperada de Y%".
- direccion "baja" (cambio_pct negativo): esa sucursal SÍ está afectada por una baja de ventas. Ahí sí aplica "afectada".
Nunca uses la palabra "afectada" para describir una alza/subida positiva — es una contradicción que confunde a la gerente.
Si preguntan cómo hacer algo en la página, usa el manual para decir en qué módulo y botón está. Si la pregunta (de datos o de interfaz) no se puede responder con lo que tienes, dilo honestamente en vez de inventar.

${manual || ''}

CONTEXTO (todo lo calculado esta semana — pedidos, proveedores, catálogo):
${JSON.stringify(contexto)}`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ],
        max_tokens: 320,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 429) {
        return res.status(429).json({
          error: 'El asistente está saturado por el momento (límite de la capa gratuita de Groq). Espera unos segundos y vuelve a intentar.',
        });
      }
      return res.status(502).json({ error: `Error de la API de Groq: ${errText}` });
    }

    const data = await response.json();
    const answer = (data.choices || [])
      .map(c => (c.message && c.message.content) || '')
      .filter(Boolean)
      .join('\n');

    return res.status(200).json({ answer: answer || 'No se pudo generar una respuesta a partir del modelo.' });
  } catch (err) {
    return res.status(500).json({ error: `Error inesperado: ${err.message}` });
  }
}
