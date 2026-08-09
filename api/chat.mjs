// api/chat.js
// Función serverless (Vercel). Corre en el servidor, nunca en el navegador,
// así que la API key de Anthropic queda segura como variable de entorno.
//
// Configúrala en Vercel: Project Settings → Environment Variables
//   ANTHROPIC_API_KEY = sk-ant-...
//
// Modelo: Claude Haiku 4.5 — el más rápido/económico de la familia,
// ideal para un chat que se va a usar muchas veces con poco presupuesto.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { question, contexto } = req.body || {};
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Falta la pregunta' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY no está configurada en el servidor. Agrégala en Vercel → Settings → Environment Variables.',
    });
  }

  // Construimos un contexto compacto (ya resumido en el navegador por data-engine.js)
  // en vez de mandar los CSVs completos: más barato, más rápido, y evita que el
  // modelo tenga que hacer los cálculos él mismo (los cálculos ya están hechos y
  // verificados en JavaScript; el modelo solo tiene que explicarlos en palabras).
  const systemPrompt = `Eres un asistente para la gerente de compras de Barrio Pizza, una cadena de pizzerías en Panamá.
Tienes acceso a un resumen YA CALCULADO de las alertas de la orden de compra de esta semana (no inventes números que no estén en el contexto).
Responde en español, de forma breve, clara y accionable — como si hablaras con alguien que no tiene tiempo de leer tablas.
Si la pregunta no se puede responder con los datos del contexto, dilo honestamente.

CONTEXTO (JSON con las alertas ya calculadas):
${JSON.stringify(contexto)}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: 'user', content: question }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: `Error de la API de Claude: ${errText}` });
    }

    const data = await response.json();
    const answer = (data.content || [])
      .map(block => (block.type === 'text' ? block.text : ''))
      .filter(Boolean)
      .join('\n');

    return res.status(200).json({ answer });
  } catch (err) {
    return res.status(500).json({ error: `Error inesperado: ${err.message}` });
  }
}
