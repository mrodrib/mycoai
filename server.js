const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

app.use(express.static(path.join(__dirname, 'public')));

const TOXICITY_VERIFICATION = {
  "amanita phalloides": { toxicity: "Mortal", deadly: true, alert: "Amatoxinas mortales. Destrucción hepática fulminante." },
  "amanita verna": { toxicity: "Mortal", deadly: true, alert: "Contiene amatoxinas. Mortal." },
  "amanita virosa": { toxicity: "Mortal", deadly: true, alert: "Cicuta fétida. Mortal." },
  "galerina marginata": { toxicity: "Mortal", deadly: true, alert: "Mortal. Síndrome faloidiano." },
  "cortinarius orellanus": { toxicity: "Mortal", deadly: true, alert: "Mortal. Provoca fallo renal irreversible tardío." },
  "chlorophyllum molybdites": { toxicity: "Tóxica Severa", deadly: false, alert: "Gastroenteritis severa aguda." },
  "omphalotus olearius": { toxicity: "Tóxica", deadly: false, alert: "Tóxica grave. Causa síndrome colinérgico." }
};

const SYSTEM_INSTRUCTIONS = `
Eres un asistente micológico estricto para análisis taxonómico preliminar.
REGLAS OBLIGATORIAS:
1. NUNCA afirmes que una seta es comestible o segura para consumir basándote en fotos.
2. Si la fotografía está desenfocada o faltan partes anatómicas clave (pie, láminas o poros), marca isClearImage = false.
3. Responde ÚNICAMENTE un objeto JSON válido con esta estructura:
{
  "isClearImage": true,
  "candidates": [
    {
      "scientificName": "Género especie",
      "commonName": "Nombre común en español",
      "probability": 0.85,
      "visualEvidences": "Rasgos morfológicos observados",
      "dangerousLookalikes": "Posibles confusiones peligrosas o mortales",
      "habitat": "Hábitat habitual"
    }
  ]
}
`;

// Lista de modelos disponibles en orden de prioridad para evitar el error 503 por saturación
const CANDIDATE_MODELS = [
  'gemini-2.0-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-pro-latest'
];

async function callGeminiWithFallback(apiKey, payload) {
  let lastError = null;

  for (const model of CANDIDATE_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        return await response.json();
      }

      const errText = await response.text();
      lastError = errText;
      console.warn(`Modelo ${model} no disponible (${response.status}), probando alternativa...`);
    } catch (e) {
      lastError = e.message;
    }
  }

  throw new Error(lastError || 'Ningún modelo de visión respondió.');
}

app.post('/api/identify', async (req, res) => {
  const { imageBase64 } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(503).json({ error: 'Falta configurar GEMINI_API_KEY en Render.' });
  }

  if (!imageBase64) {
    return res.status(400).json({ error: 'No se envió ninguna fotografía.' });
  }

  try {
    const matches = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    const mimeType = matches ? matches[1] : 'image/jpeg';
    const base64Data = matches ? matches[2] : imageBase64;

    const geminiPayload = {
      contents: [
        {
          role: "user",
          parts: [
            { text: SYSTEM_INSTRUCTIONS },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Data
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json"
      }
    };

    const aiJson = await callGeminiWithFallback(apiKey, geminiPayload);
    const rawText = aiJson.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(rawText);

    if (parsed.candidates && Array.isArray(parsed.candidates)) {
      parsed.candidates = parsed.candidates.map(c => {
        const key = (c.scientificName || '').toLowerCase().trim();
        const verified = TOXICITY_VERIFICATION[key];
        return {
          ...c,
          toxicityVerified: !!verified,
          toxicityLevel: verified ? verified.toxicity : "Precaución / No contrastada",
          isDeadly: verified ? verified.deadly : false,
          safetyAlert: verified ? verified.alert : null
        };
      });
    }

    res.json(parsed);

  } catch (err) {
    console.error("Error en inferencia:", err);
    res.status(500).json({ error: 'Error del motor de IA', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MycoAI activo en puerto ${PORT}`));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MycoAI activo en puerto ${PORT}`));
