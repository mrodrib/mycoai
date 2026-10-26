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

const SYSTEM_INSTRUCTIONS = "Eres un asistente micologico preliminar. NUNCA digas que una seta es comestible o segura para comer basandote en fotos. Responde SOLO un JSON con esta estructura: {\"isClearImage\": true, \"candidates\": [{\"scientificName\": \"Nombre latino\", \"commonName\": \"Nombre comun\", \"probability\": 0.85, \"visualEvidences\": \"detalles observados\", \"dangerousLookalikes\": \"confusiones peligrosas\", \"habitat\": \"entorno\"}]}";

// Modelos ordenados por estabilidad según las directivas de Google
const MODELS_TO_TRY = [
  'gemini-3.8-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

app.post('/api/identify', async (req, res) => {
  const { imageBase64 } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(503).json({ error: 'Falta configurar GEMINI_API_KEY en Render.' });
  }

  if (!imageBase64) {
    return res.status(400).json({ error: 'No se envió ninguna fotografía.' });
  }

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

  let lastErrorDetail = null;

  // Reintento secuencial si uno está ocupado (503) o no disponible (404)
  for (const modelName of MODELS_TO_TRY) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiPayload)
      });

      if (response.ok) {
        const aiJson = await response.json();
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

        return res.json(parsed);
      } else {
        lastErrorDetail = await response.text();
      }
    } catch (err) {
      lastErrorDetail = err.message;
    }
  }

  // Si ninguno respondió con éxito
  return res.status(500).json({
    error: 'El servicio de IA no estuvo disponible momentáneamente.',
    details: lastErrorDetail
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MycoAI escuchando en puerto ${PORT}`));
