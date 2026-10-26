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
  "omphalotus olearius": { toxicity: "Tóxica", deadly: false, alert: "Tóxica grave. Causa síndrome colinérgico." },
  "lactarius deliciosus": { toxicity: "Comestible excelente", deadly: false, alert: "Níscalo / Rovelló. Excelente comestible tras cocinado." }
};

const SYSTEM_INSTRUCTIONS = "Eres un asistente micologico preliminar. NUNCA digas que una seta es comestible o segura para comer basandote unicamente en fotos. Responde SOLO un JSON con esta estructura: {\"isClearImage\": true, \"candidates\": [{\"scientificName\": \"Nombre cientifico\", \"commonName\": \"Nombre comun en espanol\", \"probability\": 0.9, \"visualEvidences\": \"detalles visibles observados\", \"dangerousLookalikes\": \"posibles confusiones peligrosas\", \"habitat\": \"habitat probable\"}]}";

// Función que consulta a Google qué modelo de visión está ACTIVO para tu clave
async function getWorkingModelName(apiKey) {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) return null;
    const data = await res.json();

    // Buscar modelos que admitan generateContent y sean de tipo flash o pro
    const validModels = (data.models || []).filter(m =>
      m.supportedGenerationMethods &&
      m.supportedGenerationMethods.includes("generateContent") &&
      m.name.includes("gemini")
    );

    // Preferir flash por rapidez y cuota gratuita
    const preferred = validModels.find(m => m.name.includes("flash")) || validModels[0];
    return preferred ? preferred.name.replace("models/", "") : null;
  } catch (e) {
    return null;
  }
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
    // 1. Detectar modelo disponible en tiempo real
    const activeModel = await getWorkingModelName(apiKey) || "gemini-1.5-flash";
    console.log(`Usando modelo detectado: ${activeModel}`);

    const matches = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    const mimeType = matches ? matches[1] : 'image/jpeg';
    const base64Data = matches ? matches[2] : imageBase64;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${apiKey}`;

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
      return res.status(aiResponse.status).json({
        error: `Error con el modelo ${activeModel}`,
        details: errDetail
      });
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
          toxicityLevel: verified ? verified.toxicity : "Precaución / No contrastada",
          isDeadly: verified ? verified.deadly : false,
          safetyAlert: verified ? verified.alert : null
        };
      });
    }

    res.json(parsed);

  } catch (err) {
    console.error("Error en inferencia:", err);
    res.status(500).json({ error: 'Error procesando la imagen', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MycoAI activo en puerto ${PORT}`));
