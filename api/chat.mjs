// api/chat.mjs
// Función serverless (Vercel). Corre en el servidor, nunca en el navegador,
// así que la API key de Google queda segura como variable de entorno.
//
// Configúrala en Vercel: Project Settings → Environment Variables
//   GEMINI_API_KEY = ...
// (se consigue gratis, sin tarjeta de crédito, en https://aistudio.google.com/apikey)
//
// Modelo: Gemini 2.5 Flash — disponible en el tier gratuito de Google AI Studio,
// ideal para un chat que se va a usar muchas veces sin costo.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { question, contexto } = req.body || {};
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Falta la pregunta' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY no está configurada en el servidor. Agrégala en Vercel → Settings → Environment Variables.',
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
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: question }] }],
          generationConfig: { maxOutputTokens: 500 },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: `Error de la API de Gemini: ${errText}` });
    }

    const data = await response.json();
    const answer = (data.candidates || [])
      .flatMap(c => (c.content && c.content.parts) || [])
      .map(p => p.text || '')
      .filter(Boolean)
      .join('\n');

    return res.status(200).json({ answer: answer || 'No se pudo generar una respuesta a partir del modelo.' });
  } catch (err) {
    return res.status(500).json({ error: `Error inesperado: ${err.message}` });
  }
}
