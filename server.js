const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// Servir la aplicación web estática
app.use(express.static(path.join(__dirname, 'public')));

// Base toxicológica de seguridad para contrastar y evitar alucinaciones
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
Eres un asistente micológico estricto para análisis preliminar.
REGLAS OBLIGATORIAS:
1. NUNCA afirmes ni sugieras que una seta es comestible o segura para consumir.
2. Si la fotografía está desenfocada, lejos, o no muestra partes clave (pie, láminas o poros, base), pon isClearImage en false y detalla qué falta en missingFeatures.
3. Responde ÚNICAMENTE un objeto JSON válido con esta estructura:
{
  "isClearImage": true,
  "confidenceScore": 0.85,
  "missingFeatures": ["elementos ausentes si los hay"],
  "candidates": [
    {
      "scientificName": "Género especie",
      "commonName": "Nombre común en español",
      "probability": 0.85,
      "visualEvidences": "Rasgos visuales que apoyan la coincidencia",
      "dangerousLookalikes": "Especies tóxicas o mortales con las que se suele confundir",
      "habitat": "Hábitat habitual"
    }
  ]
}
`;

app.post('/api/identify', async (req, res) => {
  const { imageBase64 } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: 'Servicio no configurado',
      message: 'Falta la clave GEMINI_API_KEY en las variables de entorno del servidor.'
    });
  }

  if (!imageBase64) {
    return res.status(400).json({ error: 'No se envió ninguna imagen.' });
  }

  try {
    const matches = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    const mimeType = matches ? matches[1] : 'image/jpeg';
    const base64Data = matches ? matches[2] : imageBase64;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

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

    const aiResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });

    if (!aiResponse.ok) {
      const errDetail = await aiResponse.text();
      return res.status(aiResponse.status).json({ error: 'Error del servicio Gemini', details: errDetail });
    }

    const aiJson = await aiResponse.json();
    const rawText = aiJson.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(rawText);

    if (parsed.candidates && Array.isArray(parsed.candidates)) {
      parsed.candidates = parsed.candidates.map(c => {
        const key = (c.scientificName || '').toLowerCase().trim();
        const verified = TOXICITY_VERIFICATION[key];
        return {
          ...c,
          toxicityVerified: !!verified,
          toxicityLevel: verified ? verified.toxicity : "No contrastada con certeza",
          isDeadly: verified ? verified.deadly : false,
          safetyAlert: verified ? verified.alert : null
        };
      });
    }

    res.json({
      source: 'REAL_AI_VISION_SERVICE',
      ...parsed
    });

  } catch (err) {
    console.error("Error en inferencia:", err);
    res.status(500).json({ error: 'Error procesando la imagen', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MycoAI activo en puerto ${PORT}`));
