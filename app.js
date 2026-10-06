const MAX_DIM = 2000;

let currentView = 'decks';
let currentDeckId = null;
let currentImageId = null;

const headerTitle = document.getElementById('header-title');
const backBtn = document.getElementById('back-btn');
const addBtn = document.getElementById('add-btn');

const deckList = document.getElementById('deck-list');
const deckEmpty = document.getElementById('deck-empty');

const imageList = document.getElementById('image-list');
const imageEmpty = document.getElementById('image-empty');
const fileInput = document.getElementById('file-input');

const progressBar = document.getElementById('ocr-progress');
const progressFill = document.getElementById('ocr-progress-fill');
const progressText = document.getElementById('ocr-progress-text');
const optGrayscale = document.getElementById('opt-grayscale');
const optContrast = document.getElementById('opt-contrast');
const rerunBtn = document.getElementById('rerun-ocr-btn');
const labelSummary = document.getElementById('label-summary');

function showView(name) {
  currentView = name;
  for (const v of document.querySelectorAll('.view')) v.hidden = true;
  document.getElementById('view-' + name).hidden = false;
  backBtn.hidden = name === 'decks';
  addBtn.hidden = name === 'image' || name === 'quiz';
  if (name === 'decks') headerTitle.textContent = '덱';
}

function iconButton(label, onClick) {
  const btn = document.createElement('button');
  btn.className = 'icon-btn small';
  btn.textContent = label;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

// deck list

async function renderDeckList() {
  const decks = await getAllDecks();
  deckList.innerHTML = '';
  deckEmpty.hidden = decks.length > 0;
  for (const deck of decks) {
    const li = document.createElement('li');
    li.className = 'row';
    const main = document.createElement('button');
    main.className = 'row-main';
    main.textContent = deck.name;
    main.addEventListener('click', () => openDeck(deck.id));
    const renameBtn = iconButton('✎', async () => {
      const name = prompt('덱 이름 변경', deck.name);
      if (name) {
        await renameDeck(deck.id, name);
        renderDeckList();
      }
    });
    const deleteBtn = iconButton('🗑', async () => {
      if (confirm(`"${deck.name}" 덱을 삭제할까요? 사진도 모두 삭제됩니다.`)) {
        await deleteDeck(deck.id);
        renderDeckList();
      }
    });
    li.append(main, renameBtn, deleteBtn);
    deckList.appendChild(li);
  }
}

async function openDeck(deckId) {
  currentDeckId = deckId;
  const deck = await getDeck(deckId);
  headerTitle.textContent = deck.name;
  showView('deck');
  await renderImageList(deckId);
}

// image list

async function renderImageList(deckId) {
  const images = await getImagesByDeck(deckId);
  imageList.innerHTML = '';
  imageEmpty.hidden = images.length > 0;
  for (const image of images) {
    const li = document.createElement('li');
    li.className = 'row';
    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.src = URL.createObjectURL(imageToBlob(image));
    const main = document.createElement('button');
    main.className = 'row-main';
    main.textContent = `${image.name || '사진'} ${imageStatusLabel(image)}`;
    main.addEventListener('click', () => openImage(image.id));
    const renameBtn = iconButton('✎', async () => {
      const name = prompt('사진 이름 변경', image.name || '');
      if (name) {
        await updateImage(image.id, { name });
        renderImageList(deckId);
      }
    });
    const deleteBtn = iconButton('🗑', async () => {
      if (confirm('사진을 삭제할까요?')) {
        await deleteImage(image.id);
        renderImageList(deckId);
      }
    });
    if (image.confirmed) {
      const session = await getSessionByImage(image.id);
      const quizBtn = iconButton(session ? '이어하기' : '퀴즈', () => Quiz.openSetup(image.id));
      li.append(thumb, main, quizBtn, renameBtn, deleteBtn);
    } else {
      li.append(thumb, main, renameBtn, deleteBtn);
    }
    imageList.appendChild(li);
  }
}

function imageStatusLabel(image) {
  if (!image.ocrDone) return '· 인식 중';
  return image.confirmed ? '· 확정됨' : '· 확인 필요';
}

function baseName(filename) {
  return filename.replace(/\.[^/.]+$/, '');
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function resizeToCanvas(img) {
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (Math.max(w, h) > MAX_DIM) {
    const scale = MAX_DIM / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
}

async function addPhotoToDeck(deckId, file) {
  const img = await loadImageFile(file);
  const canvas = resizeToCanvas(img);
  const blob = await canvasToBlob(canvas);
  const record = await addImage(deckId, blob, canvas.width, canvas.height, baseName(file.name));
  return { record, canvas };
}

fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
  e.target.value = '';
  for (const file of files) {
    const { record, canvas } = await addPhotoToDeck(currentDeckId, file);
    await renderImageList(currentDeckId);
    await processOCRForImage(record.id, canvas);
    await renderImageList(currentDeckId);
  }
});

// image / OCR view

function showProgress() {
  progressBar.hidden = false;
  progressFill.style.width = '0%';
  progressText.textContent = '0%';
}

function hideProgress() {
  progressBar.hidden = true;
}

function setProgress(pct) {
  progressFill.style.width = pct + '%';
  progressText.textContent = pct + '%';
}

async function processOCRForImage(imageId, sourceEl, options = {}) {
  if (currentImageId === imageId) showProgress();
  const labels = await runOCR(sourceEl, {
    lang: 'eng',
    grayscale: options.grayscale || false,
    contrast: options.contrast || false,
    onProgress: (pct) => {
      if (currentImageId === imageId) setProgress(pct);
    }
  });
  await deleteLabelsByImage(imageId);
  const saved = await addLabels(imageId, labels);
  await updateImage(imageId, { ocrDone: true, confirmed: false });
  if (currentImageId === imageId) {
    hideProgress();
    labelSummary.textContent = '';
    await Editor.enterEditMode(imageId, { showMaskSheet: true });
  }
  return saved;
}

async function openImage(imageId) {
  Editor.teardown();
  currentImageId = imageId;
  const image = await getImage(imageId);
  showView('image');
  headerTitle.textContent = image.name || '사진';
  hideProgress();
  labelSummary.textContent = '';
  optGrayscale.checked = false;
  optContrast.checked = false;

  try {
    await loadImageIntoEl(stageImg, image);
  } catch (err) {
    console.error(err);
    alert('사진을 불러오지 못했습니다. 이 사진을 삭제하고 다시 올려주세요.');
    openDeck(image.deckId);
    return;
  }
  fitWrapToContainer(imageWrapEl, imageStageEl, image.width, image.height);
  stageSvg.setAttribute('viewBox', `0 0 ${image.width} ${image.height}`);

  if (image.ocrDone) {
    await Editor.enterEditMode(imageId, { showMaskSheet: false });
  } else {
    showProgress();
    labelSummary.textContent = '인식 중...';
    await processOCRForImage(imageId, stageImg);
  }
}

rerunBtn.addEventListener('click', async () => {
  if (!currentImageId) return;
  rerunBtn.disabled = true;
  try {
    await processOCRForImage(currentImageId, stageImg, {
      grayscale: optGrayscale.checked,
      contrast: optContrast.checked
    });
  } finally {
    rerunBtn.disabled = false;
  }
});

// navigation

addBtn.addEventListener('click', async () => {
  if (currentView === 'decks') {
    const name = prompt('덱 이름을 입력하세요');
    if (name) {
      const deck = await createDeck(name);
      await renderDeckList();
    }
  } else if (currentView === 'deck') {
    fileInput.click();
  }
});

backBtn.addEventListener('click', () => {
  if (currentView === 'deck') {
    showView('decks');
    renderDeckList();
  } else if (currentView === 'image') {
    Editor.teardown();
    openDeck(currentDeckId);
  } else if (currentView === 'quiz') {
    Quiz.exit();
    openDeck(currentDeckId);
  }
});

// init

window.addEventListener('DOMContentLoaded', async () => {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
  await renderDeckList();
  showView('decks');
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.error('SW register failed', err));
  }
});
