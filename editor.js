const MIN_BOX_PX = 10;
const TAP_THRESHOLD_SCREEN_PX = 8;
const HANDLE_SCREEN_R = 16;

const stageImg = document.getElementById('stage-img');
const stageSvg = document.getElementById('stage-svg');
const imageWrapEl = document.getElementById('image-wrap');
const imageStageEl = document.getElementById('image-stage');

// Sizes wrapEl to the largest size that fits containerEl while preserving the
// image's natural aspect ratio (never upscaling past natural size). A plain
// max-height:100% on an auto-height wrap doesn't reliably constrain a child
// <img> per the CSS spec (percentage heights against an auto-height
// containing block resolve to none), so the fit is computed explicitly here.
function fitWrapToContainer(wrapEl, containerEl, naturalW, naturalH) {
  const rect = containerEl.getBoundingClientRect();
  const scale = Math.min(rect.width / naturalW, rect.height / naturalH, 1);
  wrapEl.style.width = naturalW * scale + 'px';
  wrapEl.style.height = naturalH * scale + 'px';
}

// Loads an image record's bytes into an <img> element and waits for it to
// actually decode, rejecting (instead of hanging forever) if the browser
// fails to load it — surfaces failures instead of leaving the UI stuck.
function loadImageIntoEl(imgEl, image) {
  return new Promise((resolve, reject) => {
    if (imgEl.dataset.blobUrl) {
      URL.revokeObjectURL(imgEl.dataset.blobUrl);
    }
    const url = URL.createObjectURL(imageToBlob(image));
    imgEl.dataset.blobUrl = url;
    imgEl.onload = () => resolve(url);
    imgEl.onerror = () => reject(new Error('이미지를 불러오지 못했습니다'));
    imgEl.src = url;
  });
}

const editorToolbar = document.getElementById('editor-toolbar');
const modeSelectBtn = document.getElementById('mode-select-btn');
const modeDrawBtn = document.getElementById('mode-draw-btn');
const modeMergeBtn = document.getElementById('mode-merge-btn');
const previewToggleBtn = document.getElementById('preview-toggle-btn');
const editorSummary = document.getElementById('editor-summary');
const confirmLabelsBtn = document.getElementById('confirm-labels-btn');
const mergeConfirmBtn = document.getElementById('merge-confirm-btn');

const imageControlsBar = document.getElementById('image-controls');
const labelEditPanel = document.getElementById('label-edit-panel');
const labelTextEn = document.getElementById('label-text-en');
const labelTextKo = document.getElementById('label-text-ko');
const labelExcluded = document.getElementById('label-excluded');
const labelWrongCountEl = document.getElementById('label-wrong-count');
const labelDeleteBtn = document.getElementById('label-delete-btn');
const labelDoneBtn = document.getElementById('label-done-btn');

const maskSheet = document.getElementById('mask-sheet');
const paddingRow = document.getElementById('padding-row');
const paddingSlider = document.getElementById('padding-slider');
const paddingValue = document.getElementById('padding-value');
const leaderHint = document.getElementById('leader-hint');
const maskApplyBtn = document.getElementById('mask-apply-btn');

const EditorState = {
  imageId: null,
  image: null,
  labels: [],
  mode: 'select',
  selectedId: null,
  mergeSelection: new Set(),
  previewMode: false,
  drag: null
};

let maskPending = { mode: 'padded', padding: 10 };

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function getScale() {
  const rect = stageSvg.getBoundingClientRect();
  const vb = stageSvg.viewBox.baseVal;
  if (!rect.width || !vb.width) return 1;
  return vb.width / rect.width;
}

function clientToImage(clientX, clientY) {
  const rect = stageSvg.getBoundingClientRect();
  const scale = getScale();
  return {
    x: (clientX - rect.left) * scale,
    y: (clientY - rect.top) * scale
  };
}

// entry / exit

async function enterEditMode(imageId, { showMaskSheet }) {
  teardown();
  const image = await getImage(imageId);
  EditorState.imageId = imageId;
  EditorState.image = image;
  EditorState.labels = await getLabelsByImage(imageId);
  EditorState.mode = 'select';

  editorToolbar.hidden = false;
  fitWrapToContainer(imageWrapEl, imageStageEl, image.width, image.height);
  attachSvgHandlers();
  setMode('select');
  updateEditorSummary();

  if (showMaskSheet) {
    const deck = await getDeck(image.deckId);
    openMaskSheet(deck.maskSettings || { mode: 'padded', padding: 10 });
  } else {
    renderEditorBoxes();
  }
}

function teardown() {
  detachSvgHandlers();
  hideMaskSheet();
  labelEditPanel.hidden = true;
  imageControlsBar.hidden = false;
  mergeConfirmBtn.hidden = true;
  editorToolbar.hidden = true;
  EditorState.imageId = null;
  EditorState.image = null;
  EditorState.labels = [];
  EditorState.selectedId = null;
  EditorState.mergeSelection = new Set();
  EditorState.mode = 'select';
  EditorState.previewMode = false;
  EditorState.drag = null;
  stageSvg.innerHTML = '';
  stageSvg.classList.remove('mode-draw');
}

// rendering

function renderEditorBoxes() {
  stageSvg.innerHTML = '';

  if (EditorState.previewMode) {
    for (const l of EditorState.labels) {
      if (l.excluded) continue;
      stageSvg.appendChild(svgEl('rect', { x: l.x, y: l.y, width: l.w, height: l.h, class: 'label-box preview' }));
    }
    return;
  }

  for (const l of EditorState.labels) {
    const classes = ['label-box'];
    if (l.excluded) classes.push('excluded');
    if (l.id === EditorState.selectedId) classes.push('selected');
    if (EditorState.mergeSelection.has(l.id)) classes.push('merge-selected');
    const rect = svgEl('rect', { x: l.x, y: l.y, width: l.w, height: l.h, class: classes.join(' '), 'data-id': l.id });
    const title = svgEl('title', {});
    title.textContent = l.textEn + (l.textKo ? ' / ' + l.textKo : '');
    rect.appendChild(title);
    stageSvg.appendChild(rect);
  }

  stageSvg.classList.toggle('mode-draw', EditorState.mode === 'draw');

  if (EditorState.mode === 'select' && EditorState.selectedId != null) {
    const label = EditorState.labels.find((l) => l.id === EditorState.selectedId);
    if (label) renderHandles(label);
  }

  mergeConfirmBtn.hidden = EditorState.mergeSelection.size < 2;
}

function renderHandles(label) {
  const r = HANDLE_SCREEN_R * getScale();
  const corners = [
    { id: 'nw', x: label.x, y: label.y },
    { id: 'ne', x: label.x + label.w, y: label.y },
    { id: 'sw', x: label.x, y: label.y + label.h },
    { id: 'se', x: label.x + label.w, y: label.y + label.h }
  ];
  for (const c of corners) {
    stageSvg.appendChild(svgEl('circle', { cx: c.x, cy: c.y, r, class: 'handle', 'data-handle': c.id }));
  }
}

function renderDrawPreview(start, current) {
  let temp = document.getElementById('draw-preview-rect');
  if (!temp) {
    temp = svgEl('rect', { id: 'draw-preview-rect', class: 'label-box draw-preview' });
    stageSvg.appendChild(temp);
  }
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  const w = Math.abs(current.x - start.x);
  const h = Math.abs(current.y - start.y);
  temp.setAttribute('x', x);
  temp.setAttribute('y', y);
  temp.setAttribute('width', w);
  temp.setAttribute('height', h);
}

function clearDrawPreview() {
  const temp = document.getElementById('draw-preview-rect');
  if (temp) temp.remove();
}

function updateEditorSummary() {
  const total = EditorState.labels.length;
  const excluded = EditorState.labels.filter((l) => l.excluded).length;
  editorSummary.textContent = `${total}개 라벨 (제외 ${excluded}개)`;
}

// pointer interaction

function attachSvgHandlers() {
  stageSvg.addEventListener('pointerdown', onSvgPointerDown);
}

function detachSvgHandlers() {
  stageSvg.removeEventListener('pointerdown', onSvgPointerDown);
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
}

function onSvgPointerDown(e) {
  if (EditorState.previewMode) return;
  const target = e.target;

  if (target.classList && target.classList.contains('handle')) {
    const label = EditorState.labels.find((l) => l.id === EditorState.selectedId);
    if (!label) return;
    beginDrag({ type: 'resize', handle: target.getAttribute('data-handle'), label, startClient: { x: e.clientX, y: e.clientY }, startBox: { x: label.x, y: label.y, w: label.w, h: label.h } });
    e.preventDefault();
    return;
  }

  if (target.classList && target.classList.contains('label-box')) {
    const id = Number(target.getAttribute('data-id'));
    const label = EditorState.labels.find((l) => l.id === id);
    if (!label) return;

    if (EditorState.mode === 'merge') {
      toggleMergeSelection(id);
      return;
    }

    if (EditorState.mode === 'select') {
      if (EditorState.selectedId !== id) {
        selectLabel(id);
      } else {
        beginDrag({ type: 'move', label, startClient: { x: e.clientX, y: e.clientY }, startBox: { x: label.x, y: label.y, w: label.w, h: label.h } });
      }
      e.preventDefault();
      return;
    }
    return;
  }

  if (EditorState.mode === 'draw') {
    beginDrag({ type: 'draw', startClient: { x: e.clientX, y: e.clientY }, startImg: clientToImage(e.clientX, e.clientY) });
    e.preventDefault();
    return;
  }

  if (EditorState.mode === 'select') {
    deselect();
  }
}

function beginDrag(drag) {
  EditorState.drag = drag;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
}

function onPointerMove(e) {
  const drag = EditorState.drag;
  if (!drag) return;

  if (drag.type === 'move') {
    const scale = getScale();
    const dx = (e.clientX - drag.startClient.x) * scale;
    const dy = (e.clientY - drag.startClient.y) * scale;
    drag.label.x = clamp(drag.startBox.x + dx, 0, EditorState.image.width - drag.startBox.w);
    drag.label.y = clamp(drag.startBox.y + dy, 0, EditorState.image.height - drag.startBox.h);
    renderEditorBoxes();
  } else if (drag.type === 'resize') {
    applyResize(drag, clientToImage(e.clientX, e.clientY));
    renderEditorBoxes();
  } else if (drag.type === 'draw') {
    drag.currentImg = clientToImage(e.clientX, e.clientY);
    renderDrawPreview(drag.startImg, drag.currentImg);
  }
}

function onPointerUp(e) {
  const drag = EditorState.drag;
  EditorState.drag = null;
  window.removeEventListener('pointermove', onPointerMove);
  if (!drag) return;

  if (drag.type === 'move' || drag.type === 'resize') {
    const label = drag.label;
    updateLabel(label.id, { x: label.x, y: label.y, w: label.w, h: label.h });
  } else if (drag.type === 'draw') {
    clearDrawPreview();
    const dxScreen = e.clientX - drag.startClient.x;
    const dyScreen = e.clientY - drag.startClient.y;
    if (Math.hypot(dxScreen, dyScreen) < TAP_THRESHOLD_SCREEN_PX) return;
    const end = clientToImage(e.clientX, e.clientY);
    const x = Math.min(drag.startImg.x, end.x);
    const y = Math.min(drag.startImg.y, end.y);
    const w = Math.abs(end.x - drag.startImg.x);
    const h = Math.abs(end.y - drag.startImg.y);
    if (w < MIN_BOX_PX || h < MIN_BOX_PX) return;
    createManualLabel(x, y, w, h);
  }
}

function applyResize(drag, imgPt) {
  const { handle, startBox } = drag;
  let { x, y, w, h } = startBox;
  const minSize = MIN_BOX_PX;
  const maxW = EditorState.image.width;
  const maxH = EditorState.image.height;

  if (handle === 'se') {
    w = clamp(imgPt.x - x, minSize, maxW - x);
    h = clamp(imgPt.y - y, minSize, maxH - y);
  } else if (handle === 'nw') {
    const right = x + w, bottom = y + h;
    x = clamp(imgPt.x, 0, right - minSize);
    y = clamp(imgPt.y, 0, bottom - minSize);
    w = right - x;
    h = bottom - y;
  } else if (handle === 'ne') {
    const bottom = y + h;
    w = clamp(imgPt.x - x, minSize, maxW - x);
    y = clamp(imgPt.y, 0, bottom - minSize);
    h = bottom - y;
  } else if (handle === 'sw') {
    const right = x + w;
    w = clamp(right - imgPt.x, minSize, right);
    x = right - w;
    h = clamp(imgPt.y - y, minSize, maxH - y);
  }

  drag.label.x = x;
  drag.label.y = y;
  drag.label.w = w;
  drag.label.h = h;
}

// selection / label edit panel

function selectLabel(id) {
  EditorState.selectedId = id;
  const label = EditorState.labels.find((l) => l.id === id);
  renderEditorBoxes();
  if (label) showLabelPanel(label);
}

function deselect() {
  EditorState.selectedId = null;
  hideLabelPanel();
  renderEditorBoxes();
}

function showLabelPanel(label) {
  labelEditPanel.hidden = false;
  imageControlsBar.hidden = true;
  labelTextEn.value = label.textEn || '';
  labelTextKo.value = label.textKo || '';
  labelExcluded.checked = !!label.excluded;
  labelEditPanel.dataset.labelId = label.id;
  labelWrongCountEl.textContent = `누적 오답 ${label.wrongCount || 0}회`;
}

function hideLabelPanel() {
  labelEditPanel.hidden = true;
  imageControlsBar.hidden = false;
}

labelDoneBtn.addEventListener('click', async () => {
  const id = Number(labelEditPanel.dataset.labelId);
  const label = EditorState.labels.find((l) => l.id === id);
  if (label) {
    label.textEn = labelTextEn.value.trim();
    label.textKo = labelTextKo.value.trim();
    label.excluded = labelExcluded.checked;
    await updateLabel(id, { textEn: label.textEn, textKo: label.textKo, excluded: label.excluded });
  }
  deselect();
  updateEditorSummary();
});

labelDeleteBtn.addEventListener('click', async () => {
  const id = Number(labelEditPanel.dataset.labelId);
  if (!confirm('이 라벨을 삭제할까요?')) return;
  await deleteLabel(id);
  EditorState.labels = EditorState.labels.filter((l) => l.id !== id);
  deselect();
  updateEditorSummary();
});

// draw mode: new label

async function createManualLabel(x, y, w, h) {
  const record = await addLabel(EditorState.imageId, {
    x, y, w, h,
    baseX: x, baseY: y, baseW: w, baseH: h,
    textEn: '', textKo: '', excluded: false, ocrConfidence: 100, wrongCount: 0
  });
  EditorState.labels.push(record);
  setMode('select');
  selectLabel(record.id);
  updateEditorSummary();
  setTimeout(() => labelTextEn.focus(), 50);
}

// merge mode

function toggleMergeSelection(id) {
  if (EditorState.mergeSelection.has(id)) {
    EditorState.mergeSelection.delete(id);
  } else {
    EditorState.mergeSelection.add(id);
  }
  renderEditorBoxes();
}

mergeConfirmBtn.addEventListener('click', async () => {
  const ids = Array.from(EditorState.mergeSelection);
  if (ids.length < 2) return;
  const selected = EditorState.labels.filter((l) => ids.includes(l.id)).sort((a, b) => a.x - b.x);

  const x = Math.min(...selected.map((l) => l.x));
  const y = Math.min(...selected.map((l) => l.y));
  const right = Math.max(...selected.map((l) => l.x + l.w));
  const bottom = Math.max(...selected.map((l) => l.y + l.h));
  const w = right - x, h = bottom - y;
  const textEn = selected.map((l) => l.textEn).filter(Boolean).join(' ');
  const textKo = selected.map((l) => l.textKo).filter(Boolean).join(' ');
  const excluded = selected.every((l) => l.excluded);
  const ocrConfidence = Math.round(selected.reduce((s, l) => s + (l.ocrConfidence || 0), 0) / selected.length);

  const merged = await addLabel(EditorState.imageId, {
    x, y, w, h, baseX: x, baseY: y, baseW: w, baseH: h,
    textEn, textKo, excluded, ocrConfidence, wrongCount: 0
  });
  for (const id of ids) await deleteLabel(id);

  EditorState.labels = EditorState.labels.filter((l) => !ids.includes(l.id));
  EditorState.labels.push(merged);
  EditorState.mergeSelection.clear();
  setMode('select');
  updateEditorSummary();
});

// mode / preview toggles

function setMode(mode) {
  EditorState.mode = mode;
  EditorState.mergeSelection.clear();
  EditorState.selectedId = null;
  hideLabelPanel();
  [modeSelectBtn, modeDrawBtn, modeMergeBtn].forEach((b) => b.classList.remove('active'));
  if (mode === 'select') modeSelectBtn.classList.add('active');
  if (mode === 'draw') modeDrawBtn.classList.add('active');
  if (mode === 'merge') modeMergeBtn.classList.add('active');
  renderEditorBoxes();
}

modeSelectBtn.addEventListener('click', () => setMode('select'));
modeDrawBtn.addEventListener('click', () => setMode('draw'));
modeMergeBtn.addEventListener('click', () => setMode('merge'));

previewToggleBtn.addEventListener('click', () => {
  EditorState.previewMode = !EditorState.previewMode;
  previewToggleBtn.classList.toggle('active', EditorState.previewMode);
  renderEditorBoxes();
});

// mask range sheet

function openMaskSheet(settings) {
  maskPending = { mode: settings.mode, padding: settings.padding };
  updateMaskSheetUI();
  maskSheet.hidden = false;
  previewMaskOnLabels();
}

function hideMaskSheet() {
  maskSheet.hidden = true;
}

function updateMaskSheetUI() {
  document.querySelectorAll('.sheet-option').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === maskPending.mode);
  });
  paddingSlider.value = maskPending.padding;
  paddingValue.textContent = maskPending.padding + 'px';
  paddingRow.hidden = maskPending.mode === 'text';
  leaderHint.hidden = maskPending.mode !== 'leader';
}

document.querySelectorAll('.sheet-option').forEach((btn) => {
  btn.addEventListener('click', () => {
    maskPending.mode = btn.dataset.mode;
    updateMaskSheetUI();
    previewMaskOnLabels();
  });
});

paddingSlider.addEventListener('input', () => {
  maskPending.padding = Number(paddingSlider.value);
  paddingValue.textContent = maskPending.padding + 'px';
  previewMaskOnLabels();
});

function padBox(label, padding) {
  let x = label.baseX - padding;
  let y = label.baseY - padding;
  let w = label.baseW + padding * 2;
  let h = label.baseH + padding * 2;
  const maxW = EditorState.image.width;
  const maxH = EditorState.image.height;
  x = clamp(x, 0, maxW);
  y = clamp(y, 0, maxH);
  if (x + w > maxW) w = maxW - x;
  if (y + h > maxH) h = maxH - y;
  return { x, y, w, h };
}

function previewMaskOnLabels() {
  const padding = maskPending.mode === 'text' ? 0 : maskPending.padding;
  for (const l of EditorState.labels) {
    const box = padBox(l, padding);
    l.x = box.x;
    l.y = box.y;
    l.w = box.w;
    l.h = box.h;
  }
  renderEditorBoxes();
}

maskApplyBtn.addEventListener('click', async () => {
  await updateDeckMaskSettings(EditorState.image.deckId, { mode: maskPending.mode, padding: maskPending.padding });
  for (const l of EditorState.labels) {
    await updateLabel(l.id, { x: l.x, y: l.y, w: l.w, h: l.h });
  }
  hideMaskSheet();
  setMode('select');
});

// confirm

confirmLabelsBtn.addEventListener('click', async () => {
  await updateImage(EditorState.imageId, { confirmed: true });
  openDeck(EditorState.image.deckId);
});

window.Editor = { enterEditMode, teardown };
