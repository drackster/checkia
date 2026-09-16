const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const uploadSection = document.getElementById('uploadSection');
const previewSection = document.getElementById('previewSection');
const mediaPreview = document.getElementById('mediaPreview');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const changeFileBtn = document.getElementById('changeFile');
const analyzeBtn = document.getElementById('analyzeBtn');
const analyzeBtnText = document.getElementById('analyzeBtnText');
const checkOpenAI = document.getElementById('checkOpenAI');
const checkGemini = document.getElementById('checkGemini');
const loadingSection = document.getElementById('loadingSection');
const loadingMediaPreview = document.getElementById('loadingMediaPreview');
const progressItemOpenAI = document.getElementById('progressItemOpenAI');
const progressItemGemini = document.getElementById('progressItemGemini');
const resultsSection = document.getElementById('resultsSection');
const resultMediaContainer = document.getElementById('resultMediaContainer');
const resultMediaPreview = document.getElementById('resultMediaPreview');
const resultFileName = document.getElementById('resultFileName');
const resultFileSize = document.getElementById('resultFileSize');
const mainResult = document.getElementById('mainResult');
const individualResults = document.getElementById('individualResults');
const newAnalysisBtn = document.getElementById('newAnalysis');
const paymentSection = document.getElementById('paymentSection');
const paypalButtonContainer = document.getElementById('paypalButtonContainer');

let selectedFile = null;
let paypalConfig = null;
let paypalSdkLoaded = false;

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const files = e.dataTransfer.files;
  if (files.length > 0) handleFile(files[0]);
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

changeFileBtn.addEventListener('click', () => fileInput.click());
analyzeBtn.addEventListener('click', startAnalysis);
newAnalysisBtn.addEventListener('click', resetToUpload);

initPayPal();

async function initPayPal() {
  try {
    const res = await fetch('/api/config');
    paypalConfig = await res.json();
  } catch (e) {
    paypalConfig = null;
    return;
  }

  if (!paypalConfig || !paypalConfig.paypal_enabled) {
    return;
  }

  if (!paypalConfig.paypal_client_id) {
    paymentSection.classList.remove('hidden');
    paymentSection.innerHTML = '<p class="payment-error">PayPal habilitado pero falta PAYPAL_CLIENT_ID en el archivo .env</p>';
    return;
  }

  try {
    await loadPayPalSDK(paypalConfig);
    renderPayPalButtons();
    paymentSection.classList.remove('hidden');
  } catch (e) {
    console.error('No se pudo cargar PayPal:', e);
  }
}

function loadPayPalSDK(config) {
  return new Promise((resolve, reject) => {
    if (paypalSdkLoaded) return resolve();
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${config.paypal_client_id}&currency=${config.paypal_currency}&intent=capture`;
    script.onload = () => {
      paypalSdkLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Fallo al cargar el SDK de PayPal'));
    document.body.appendChild(script);
  });
}

function renderPayPalButtons() {
  paypal.Buttons({
    style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal' },
    createOrder: (data, actions) => actions.order.create({
      purchase_units: [{
        amount: {
          value: paypalConfig.paypal_amount,
          currency_code: paypalConfig.paypal_currency
        }
      }]
    }),
    onApprove: async (data, actions) => {
      try {
        const res = await fetch('/api/paypal/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderID: data.orderID })
        });
        const result = await res.json();
        if (result.success) {
          paypalButtonContainer.innerHTML = '<p class="payment-success">Pago aprobado. Gracias por tu apoyo.</p>';
        } else {
          alert('El pago no pudo confirmarse: ' + (result.error || 'Error desconocido'));
        }
      } catch (e) {
        alert('Error al confirmar el pago: ' + e.message);
      }
    },
    onCancel: () => {}
  }).render('#paypalButtonContainer');
}

function getSelectedProviders() {
  const providers = [];
  if (checkOpenAI.checked) providers.push('openai');
  if (checkGemini.checked) providers.push('gemini');
  return providers;
}

function updateAISelectionUI() {
  const count = getSelectedProviders().length;
  if (count === 0) {
    analyzeBtnText.textContent = 'Selecciona al menos 1 IA';
    analyzeBtn.disabled = true;
  } else if (count === 1) {
    analyzeBtnText.textContent = 'Analizar con 1 IA';
    analyzeBtn.disabled = false;
  } else {
    analyzeBtnText.textContent = `Analizar con ${count} IAs`;
    analyzeBtn.disabled = false;
  }
}

checkOpenAI.addEventListener('change', updateAISelectionUI);
checkGemini.addEventListener('change', updateAISelectionUI);

function renderMediaInto(container, file) {
  container.innerHTML = '';
  if (!file) return;
  if (file.type.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    container.appendChild(img);
  } else if (file.type.startsWith('video/')) {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    video.controls = true;
    video.muted = true;
    container.appendChild(video);
  }
}

function handleFile(file) {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/mov', 'video/webm'];
  if (!allowedTypes.includes(file.type)) {
    alert('Tipo de archivo no soportado. Usa JPG, PNG, GIF, WebP, MP4, MOV o WebM.');
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    alert('El archivo supera el limite de 50MB.');
    return;
  }

  selectedFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);

  renderMediaInto(mediaPreview, file);
  updateAISelectionUI();

  dropZone.classList.add('hidden');
  previewSection.classList.remove('hidden');
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function startAnalysis() {
  if (!selectedFile) return;

  const selectedProviders = getSelectedProviders();
  if (selectedProviders.length === 0) {
    alert('Por favor selecciona al menos una IA para verificar.');
    return;
  }

  analyzeBtn.disabled = true;
  previewSection.classList.add('hidden');
  renderMediaInto(loadingMediaPreview, selectedFile);
  loadingSection.classList.remove('hidden');
  resultsSection.classList.add('hidden');

  progressItemOpenAI.style.display = selectedProviders.includes('openai') ? 'flex' : 'none';
  progressItemGemini.style.display = selectedProviders.includes('gemini') ? 'flex' : 'none';

  selectedProviders.forEach(ai => simulateProgress(ai, 0, 80));

  const formData = new FormData();
  formData.append('media', selectedFile);
  formData.append('providers', JSON.stringify(selectedProviders));

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Error al analizar el contenido');
    }

    selectedProviders.forEach(ai => completeProgress(ai));

    setTimeout(() => showResults(data), 500);

  } catch (error) {
    alert('Error: ' + error.message);
    resetToUpload();
  }
}

function simulateProgress(ai, from, to) {
  const bar = document.getElementById(`progress-${ai}`);
  const status = document.getElementById(`status-${ai}`);
  const names = { openai: 'ChatGPT', gemini: 'Gemini' };

  status.textContent = 'Analizando...';
  let current = from;
  const interval = setInterval(() => {
    current += Math.random() * 15;
    if (current >= to) {
      clearInterval(interval);
      current = to;
    }
    bar.style.width = current + '%';
  }, 500);

  bar._interval = interval;
}

function completeProgress(ai) {
  const bar = document.getElementById(`progress-${ai}`);
  const status = document.getElementById(`status-${ai}`);
  if (bar._interval) clearInterval(bar._interval);
  bar.style.width = '100%';
  status.textContent = 'Completado';
  status.style.color = '#00ff88';
}

function showResults(data) {
  loadingSection.classList.add('hidden');
  resultsSection.classList.remove('hidden');
  analyzeBtn.disabled = false;

  if (selectedFile) {
    renderMediaInto(resultMediaPreview, selectedFile);
    resultFileName.textContent = selectedFile.name;
    resultFileSize.textContent = formatFileSize(selectedFile.size);
  }

  individualResults.innerHTML = '';

  const successes = data.resultados_individuales.filter(r => r.success)
    .map(r => ({ r, parsed: parseLocalResponse(r.response) }));
  const positives = successes.filter(s => s.parsed.es_ia === true);

  if (positives.length > 0) {
    positives.forEach(s => {
      const { r, parsed } = s;

      let cardVerdictClass = parsed.veredicto.toLowerCase().replace('_', '-');
      if (!['real', 'ia-generada', 'manipulada'].includes(cardVerdictClass)) {
        cardVerdictClass = 'error';
      }
      if (parsed.veredicto === 'IA_GENERADA') cardVerdictClass = 'ai';

      let cardVerdictText = parsed.veredicto;
      if (parsed.veredicto === 'REAL') cardVerdictText = 'REAL';
      else if (parsed.veredicto === 'IA_GENERADA') cardVerdictText = 'IA';
      else if (parsed.veredicto === 'MANIPULADA') cardVerdictText = 'MANIPULADA';
      else cardVerdictText = 'ERROR';

      const card = document.createElement('div');
      card.className = 'ai-result-card success';
      card.innerHTML = `
        <div class="card-ai-name">${r.ia}</div>
        <div class="card-verdict ${cardVerdictClass}">${cardVerdictText}</div>
        <div class="card-binary ${cardVerdictClass}">SI</div>
        <div class="card-label">elaborado o manipulado por IA</div>
      `;
      individualResults.appendChild(card);
    });
  } else {
    const card = document.createElement('div');
    card.className = 'ai-result-card success verdict-only';

    if (successes.length > 0) {
      card.innerHTML = `
        <div class="card-binary real">NO</div>
        <div class="card-label">ninguna IA detecto contenido generado por IA. El contenido parece real.</div>
      `;
    } else {
      card.className = 'ai-result-card error verdict-only';
      card.innerHTML = `
        <div class="card-binary error">--</div>
        <div class="card-label">no fue posible analizar el contenido.</div>
      `;
    }
    individualResults.appendChild(card);
  }
}

function parseLocalResponse(text) {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const veredicto = (parsed.veredicto || 'REAL').toUpperCase();
      let es_ia = String(parsed.es_contenido_ia).toLowerCase() === 'true' ||
        String(parsed.generado_por_propia_ia).toLowerCase() === 'true';
      if (!es_ia && veredicto !== 'REAL' && veredicto !== 'INCONCLUSO') es_ia = true;
      parsed.veredicto = veredicto;
      parsed.es_ia = es_ia;
      return parsed;
    }
  } catch (e) {}

  const lowerText = text.toLowerCase();
  let veredicto = 'REAL';
  let es_ia = false;

  if (lowerText.includes('ia generada') || lowerText.includes('generated by ai') ||
      lowerText.includes('artificialmente generada') || lowerText.includes('deepfake') ||
      lowerText.includes('sintética') || lowerText.includes('sintetica') ||
      lowerText.includes('ai-generated') || lowerText.includes('generated by an ai')) {
    veredicto = 'IA_GENERADA';
    es_ia = true;
  } else if (lowerText.includes('manipulada') || lowerText.includes('edited') ||
             lowerText.includes('modificada') || lowerText.includes('alterada') ||
             lowerText.includes('digitally altered')) {
    veredicto = 'MANIPULADA';
    es_ia = true;
  }

  return {
    veredicto,
    es_ia,
    razones: [text.substring(0, 300)],
    analisis_detallado: text
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function resetToUpload() {
  selectedFile = null;
  fileInput.value = '';
  mediaPreview.innerHTML = '';
  loadingMediaPreview.innerHTML = '';
  resultMediaPreview.innerHTML = '';
  resultFileName.textContent = '';
  resultFileSize.textContent = '';
  dropZone.classList.remove('hidden');
  previewSection.classList.add('hidden');
  loadingSection.classList.add('hidden');
  resultsSection.classList.add('hidden');
  analyzeBtn.disabled = false;

  ['openai', 'gemini'].forEach(ai => {
    const bar = document.getElementById(`progress-${ai}`);
    const status = document.getElementById(`status-${ai}`);
    bar.style.width = '0%';
    status.textContent = 'Enviando...';
    status.style.color = '#666';
  });

  progressItemOpenAI.style.display = 'flex';
  progressItemGemini.style.display = 'flex';
  updateAISelectionUI();
}
