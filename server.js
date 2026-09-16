require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

const PAYPAL_ENABLED = process.env.PAYPAL_ENABLED === 'true';
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_SECRET = process.env.PAYPAL_SECRET || '';
const PAYPAL_AMOUNT = process.env.PAYPAL_AMOUNT || '1.00';
const PAYPAL_CURRENCY = process.env.PAYPAL_CURRENCY || 'USD';
const PAYPAL_BASE = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

async function getPayPalToken() {
  const res = await axios.post(
    `${PAYPAL_BASE}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );
  return res.data.access_token;
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|mov|avi|webm/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) return cb(null, true);
    cb(new Error('Solo se permiten archivos de imagen y video'));
  }
});

function getPromptForIA(iaName) {
  const envKey = iaName === 'Gemini' ? 'GEMINI_PROMPT' : 'OPENAI_PROMPT';
  const customPrompt = process.env[envKey];
  if (customPrompt && customPrompt.trim()) return customPrompt;

  const specificSelfCheck = iaName === 'Gemini'
    ? `- ¿Reconoces si esta imagen o video fue generado por herramientas y modelos de Google (como Imagen 3, Imagen 2, Veo, Gemini)? Presta especial atención al estilo de renderizado característico de Imagen, iluminación volumétrica típica, estética hiperrealista sintética, marcas de agua invisibles o SynthID si son detectables, patrones de desenfoque de fondo y suavizado característico de los modelos de Google.`
    : `- ¿Reconoces si esta imagen o video fue generado por modelos de OpenAI (como DALL-E 3, DALL-E 2, Sora)? Examina la composición típica de DALL-E 3, el tipo de saturación, el tratamiento característico de ojos, cabello y piel, la paleta cromática y el nivel de micro-detalle sintético propio de tus generadores.`;

  return `Eres un evaluador forense digital avanzado especializado en detección de contenido sintético.
Tu tarea primordial es determinar si esta imagen/video fue GENERADO POR INTELIGENCIA ARTIFICIAL, y en particular evaluar si proviene de tus propias herramientas o tecnologías (${iaName}):

${specificSelfCheck}

Realiza un examen profundo y no superficial:
1. Análisis de micro-texturas (poros de piel, transiciones de cabello, fibras textiles que pierden cohesión).
2. Coherencia física: trazado de rayos, rebotes de luz, fuentes de luz secundarias e inconsistencia en sombras.
3. Detalles anatómicos y de fondo: simetría de orejas, bordes de dedos, accesorios fusionados con el cuerpo o fondos con objetos incoherentes o "alucinados".
4. Texto y geometría: patrones repetitivos artificiales, letras con trazos anómalos o distorsiones sutiles.
5. Calidad sintética: estética "encerada", contraste hiperdefinido sin ruido orgánico de sensor de cámara (ruido ISO ausente o uniforme de post-proceso).
6. Huellas digitales de IA: busca marcas de agua sintéticas, metadatos EXIF anómalos, firmas discretas, patrones repetidos de codificación o ruido estocástico que los motores de IA insertan al generar o manipular contenido. Estas huellas sirven para análisis forenses futuros, como el presente caso, permitiendo identificar el origen o la herramienta responsable.

Si encuentras señales de generación sintética (sea de tu propio ecosistema o de otro motor de IA como Midjourney, Stable Diffusion, etc.), tu veredicto DEBE ser "IA_GENERADA" o "MANIPULADA".

Responde ÚNICAMENTE en este formato JSON válido (sin markdown, sin bloques de código):
{
  "es_contenido_ia": true o false,
  "veredicto": "REAL" o "IA_GENERADA" o "MANIPULADA",
  "generado_por_propia_ia": true o false,
  "razones": ["razón 1 específica", "razón 2 específica"],
  "analisis_detallado": "SÍNTESIS BREVE de máximo 2 o 3 frases. No desarrolles ni expliques en extenso: resume en pocas líneas el hallazgo principal y las 2 señales forenses más determinantes que respaldan la conclusión."
}`;
}

async function analyzeWithOpenAI(filePath, mimeType) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const fileBuffer = fs.readFileSync(filePath);
  const base64Image = fileBuffer.toString('base64');
  const prompt = getPromptForIA('ChatGPT');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
              detail: 'high'
            }
          }
        ]
      }
    ],
    max_tokens: 1000
  });

  return response.choices[0].message.content;
}

async function analyzeWithGemini(filePath, mimeType) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const fileBuffer = fs.readFileSync(filePath);
  const base64Image = fileBuffer.toString('base64');
  const prompt = getPromptForIA('Gemini');
  const payload = [
    prompt,
    {
      inlineData: {
        mimeType: mimeType,
        data: base64Image
      }
    }
  ];

  const models = ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];
  let lastError;

  for (const modelName of models) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(payload);
      return result.response.text();
    } catch (err) {
      lastError = err;
      console.error(`[Gemini Error (${modelName})]:`, err.message);
      if (err.message && (err.message.includes('429') || err.message.includes('503'))) {
        await new Promise(res => setTimeout(res, 1500));
      }
    }
  }

  throw lastError;
}

function parseAIResponse(text) {
  let parsed = null;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {}

  if (parsed && typeof parsed === 'object') {
    const isSelfGenerated = parsed.generado_por_propia_ia === true ||
      String(parsed.generado_por_propia_ia).toLowerCase() === 'true';

    const veredicto = isSelfGenerated ? 'IA_GENERADA' : (parsed.veredicto || 'REAL');
    const esIA = parsed.es_contenido_ia === true ||
      String(parsed.es_contenido_ia).toLowerCase() === 'true' ||
      veredicto !== 'REAL';

    return {
      veredicto,
      es_ia: isSelfGenerated ? true : esIA,
      generado_por_propia_ia: isSelfGenerated,
      razones: Array.isArray(parsed.razones) ? parsed.razones : [String(parsed.razones || '')],
      analisis_detallado: parsed.analisis_detallado || text
    };
  }

  const lowerText = text.toLowerCase();
  let veredicto = 'REAL';
  const isSelf = lowerText.includes('generado por mi') ||
                 lowerText.includes('generada por mi') ||
                 lowerText.includes('generado por imagen') ||
                 lowerText.includes('generada por imagen') ||
                 lowerText.includes('generado por dalle') ||
                 lowerText.includes('generado por dALL-e') ||
                 lowerText.includes('reconozco mi estilo') ||
                 lowerText.includes('synthid detectado');

  if (isSelf || lowerText.includes('ia generada') || lowerText.includes('generated by ai') ||
      lowerText.includes('artificialmente generada') || lowerText.includes('deepfake') ||
      lowerText.includes('sintética') || lowerText.includes('sintetica')) {
    veredicto = 'IA_GENERADA';
  } else if (lowerText.includes('manipulada') || lowerText.includes('edited') ||
             lowerText.includes('modificada') || lowerText.includes('alterada')) {
    veredicto = 'MANIPULADA';
  }

  return {
    veredicto,
    es_ia: isSelf || veredicto !== 'REAL',
    generado_por_propia_ia: isSelf,
    razones: [text.substring(0, 200)],
    analisis_detallado: text
  };
}

function calculateConsensus(results) {
  const validResults = results.filter(r => r.success);
  if (validResults.length === 0) return { total: 0, porcentaje: 0, veredicto: 'SIN_DATOS' };

  const parsed = validResults.map(r => ({
    ia: r.ia,
    ...parseAIResponse(r.response)
  }));

  // Si alguna IA reconoce que fue creada con sus propias herramientas, tiene prioridad absoluta 100%
  const autoReconocida = parsed.find(p => p.generado_por_propia_ia === true);
  if (autoReconocida) {
    return {
      total: validResults.length,
      porcentaje: 100,
      veredicto: 'IA_GENERADA',
      auto_reconocida: true,
      ia_que_reconocio: autoReconocida.ia,
      votos: { REAL: 0, IA_GENERADA: validResults.length, MANIPULADA: 0 },
      analisis_individual: parsed
    };
  }

  const votes = { REAL: 0, IA_GENERADA: 0, MANIPULADA: 0 };

  parsed.forEach(p => {
    votes[p.veredicto] = (votes[p.veredicto] || 0) + 1;
  });

  const total = validResults.length;
  const maxVote = Math.max(votes.REAL, votes.IA_GENERADA, votes.MANIPULADA);
  let veredicto = 'INCONCLUSO';

  if (maxVote === votes.REAL) veredicto = 'REAL';
  else if (maxVote === votes.IA_GENERADA) veredicto = 'IA_GENERADA';
  else if (maxVote === votes.MANIPULADA) veredicto = 'MANIPULADA';

  const porcentaje = Math.round((maxVote / total) * 100);

  return {
    total,
    porcentaje,
    veredicto,
    votos: votes,
    analisis_individual: parsed
  };
}

app.post('/api/analyze', upload.single('media'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se envió ningún archivo' });

  const filePath = req.file.path;
  const mimeType = req.file.mimetype;

  let providers = ['openai', 'gemini'];
  if (req.body.providers) {
    try {
      providers = typeof req.body.providers === 'string' ? JSON.parse(req.body.providers) : req.body.providers;
      if (!Array.isArray(providers)) providers = [providers];
    } catch (e) {
      providers = String(req.body.providers).split(',').map(s => s.trim().toLowerCase());
    }
  }

  const tasks = [];
  if (providers.includes('openai') || providers.includes('chatgpt')) {
    tasks.push(
      analyzeWithOpenAI(filePath, mimeType).then(r => ({ success: true, response: r, ia: 'ChatGPT' }))
        .catch(e => {
          console.error('[ChatGPT Error]:', e.message);
          return { success: false, error: e.message, ia: 'ChatGPT' };
        })
    );
  }

  if (providers.includes('gemini')) {
    tasks.push(
      analyzeWithGemini(filePath, mimeType).then(r => ({ success: true, response: r, ia: 'Gemini' }))
        .catch(e => {
          console.error('[Gemini Error]:', e.message);
          return { success: false, error: e.message, ia: 'Gemini' };
        })
    );
  }

  if (tasks.length === 0) {
    fs.unlink(filePath, () => {});
    return res.status(400).json({ error: 'Debes seleccionar al menos una IA para analizar' });
  }

  const analyses = await Promise.allSettled(tasks);

  const results = analyses.map(a => a.status === 'fulfilled' ? a.value : { success: false, error: a.reason?.message, ia: 'Desconocido' });
  const consensus = calculateConsensus(results);

  // Cleanup uploaded file
  fs.unlink(filePath, () => {});

  res.json({
    success: true,
    consensus,
    resultados_individuales: results
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/config', (req, res) => {
  res.json({
    paypal_enabled: PAYPAL_ENABLED,
    paypal_client_id: PAYPAL_CLIENT_ID,
    paypal_currency: PAYPAL_CURRENCY,
    paypal_amount: PAYPAL_AMOUNT
  });
});

app.post('/api/paypal/capture', async (req, res) => {
  try {
    if (!PAYPAL_ENABLED) {
      return res.status(400).json({ error: 'Pasarela de pagos desactivada' });
    }
    const { orderID } = req.body;
    if (!orderID) return res.status(400).json({ error: 'Falta el orderID' });

    const token = await getPayPalToken();
    const capture = await axios.post(
      `${PAYPAL_BASE}/v2/checkout/orders/${orderID}/capture`,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      success: capture.data.status === 'COMPLETED',
      status: capture.data.status,
      payer: capture.data.payer?.email_address || null
    });
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor CheckIA corriendo en http://localhost:${PORT}`);
});
