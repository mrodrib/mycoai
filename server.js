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
  "lactarius deliciosus": { toxicity: "Comestible excelente", deadly: false, alert: "Níscalo / Rovelló. Excelente comestible tras cocinado." },
  "lactarius sanguifluus": { toxicity: "Comestible excelente", deadly: false, alert: "Níscalo de sangre vinosa. Excelente comestible." }
};

const SYSTEM_INSTRUCTIONS = "Eres un asistente micologico estricto. NUNCA afirmes que una seta es comestible basandote en fotos. Responde SOLO un JSON con: {\"isClearImage\": true, \"candidates\": [{\"scientificName\": \"Nombre latino\", \"commonName\": \"Nombre comun\", \"probability\": 0.9, \"visualEvidences\": \"detalles observados\", \"dangerousLookalikes\": \"confusiones peligrosas\", \"habitat\": \"entorno probable\"}]}";

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

    // 1. Probamos con la nueva Interactions API (recomendada por Google en tu error)
    const interactionsUrl = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${apiKey}`;
    const interactionsPayload = {
      model: "gemini-3.8-flash",
      input: [
        { type: "text", text: SYSTEM_INSTRUCTIONS },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mimeType,
            data: base64Data
          }
        }
      ],
      response_format: { type: "json_object" }
    };

    let aiResponse = await fetch(interactionsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(interactionsPayload)
    });

    let rawText = "";

    if (aiResponse.ok) {
      const data = await aiResponse.json();
      rawText = data.output_text || (data.candidates && data.candidates[0]?.content?.parts[0]?.text);
    } else {
      // 2. Si falla la Interactions API, respaldo inmediato con generateContent usando gemini-3.8-flash
      const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;
      const genPayload = {
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

      const fallbackRes = await fetch(genUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(genPayload)
      });

      if (!fallbackRes.ok) {
        const errDetail = await fallbackRes.text();
        return res.status(fallbackRes.status).json({ error: 'Google AI rechazó la petición', details: errDetail });
      }

      const fallbackData = await fallbackRes.json();
      rawText = fallbackData.candidates[0].content.parts[0].text;
    }

    // Limpieza y parseo de la respuesta JSON
    const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJson);

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
