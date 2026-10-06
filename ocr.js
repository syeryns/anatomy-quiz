const OCR_CONFIDENCE_THRESHOLD = 60;

function clamp255(v) {
  return Math.max(0, Math.min(255, v));
}

function preprocessImage(sourceEl, { grayscale, contrast }) {
  const width = sourceEl.naturalWidth || sourceEl.width;
  const height = sourceEl.naturalHeight || sourceEl.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sourceEl, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const contrastFactor = contrast ? 1.6 : 1;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2];
    if (grayscale) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = gray;
    }
    if (contrast) {
      r = (r - 128) * contrastFactor + 128;
      g = (g - 128) * contrastFactor + 128;
      b = (b - 128) * contrastFactor + 128;
    }
    data[i] = clamp255(r);
    data[i + 1] = clamp255(g);
    data[i + 2] = clamp255(b);
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function isLowQuality(text, confidence) {
  const compact = text.replace(/\s/g, '');
  if (confidence < OCR_CONFIDENCE_THRESHOLD) return true;
  if (compact.length <= 1) return true;
  if (/^\d+$/.test(compact)) return true;
  return false;
}

function mergeWordsToLabel(words) {
  const text = words.map((w) => w.text.trim()).join(' ').trim();
  const x0 = Math.min(...words.map((w) => w.bbox.x0));
  const y0 = Math.min(...words.map((w) => w.bbox.y0));
  const x1 = Math.max(...words.map((w) => w.bbox.x1));
  const y1 = Math.max(...words.map((w) => w.bbox.y1));
  const confidence = words.reduce((sum, w) => sum + w.confidence, 0) / words.length;
  return {
    x: x0,
    y: y0,
    w: x1 - x0,
    h: y1 - y0,
    baseX: x0,
    baseY: y0,
    baseW: x1 - x0,
    baseH: y1 - y0,
    textEn: text,
    textKo: '',
    ocrConfidence: Math.round(confidence),
    excluded: isLowQuality(text, confidence),
    wrongCount: 0
  };
}

function buildLabels(data) {
  const labels = [];
  const lines = data.lines || [];
  for (const line of lines) {
    const words = (line.words || []).filter((w) => w.text && w.text.trim().length > 0);
    if (words.length === 0) continue;
    words.sort((a, b) => a.bbox.x0 - b.bbox.x0);

    let group = [words[0]];
    for (let i = 1; i < words.length; i++) {
      const prev = group[group.length - 1];
      const cur = words[i];
      const avgHeight = ((prev.bbox.y1 - prev.bbox.y0) + (cur.bbox.y1 - cur.bbox.y0)) / 2;
      const gap = cur.bbox.x0 - prev.bbox.x1;
      const threshold = Math.max(10, avgHeight * 0.8);
      if (gap <= threshold) {
        group.push(cur);
      } else {
        labels.push(mergeWordsToLabel(group));
        group = [cur];
      }
    }
    labels.push(mergeWordsToLabel(group));
  }
  return labels;
}

async function runOCR(sourceEl, { lang = 'eng', grayscale = false, contrast = false, onProgress } = {}) {
  const source = (grayscale || contrast) ? preprocessImage(sourceEl, { grayscale, contrast }) : sourceEl;
  const worker = await Tesseract.createWorker(lang, 1, {
    logger: (m) => {
      if (onProgress && m.status === 'recognizing text') {
        onProgress(Math.round(m.progress * 100));
      }
    }
  });
  try {
    const { data } = await worker.recognize(source);
    return buildLabels(data);
  } finally {
    await worker.terminate();
  }
}
