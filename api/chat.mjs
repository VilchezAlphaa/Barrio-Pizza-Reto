// api/chat.mjs
// Función serverless (Vercel). Corre en el servidor, nunca en el navegador,
// así que la API key de Groq queda segura como variable de entorno.
//
// Configúrala en Vercel: Project Settings → Environment Variables
//   GROQAPIKEY = ...
// (se consigue gratis, sin tarjeta de crédito, en https://console.groq.com)
//
// Modelo: llama-3.3-70b-versatile — disponible en el tier gratuito de Groq
// (14,400 requests/día), rápido y sin costo.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { question, contexto } = req.body || {};
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
Tienes acceso a un resumen YA CALCULADO de las alertas de la orden de compra de esta semana (no inventes números que no estén en el contexto).
Responde en español, de forma breve, clara y accionable — como si hablaras con alguien que no tiene tiempo de leer tablas.
Si la pregunta no se puede responder con los datos del contexto, dilo honestamente.

CONTEXTO (JSON con las alertas ya calculadas):
${JSON.stringify(contexto)}`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ],
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
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
