const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const TAP_THRESHOLD_QUIZ = 8;
const HIT_TOLERANCE_PX = 8;

const quizStage = document.getElementById('quiz-stage');
const quizWrap = document.getElementById('quiz-wrap');
const quizImg = document.getElementById('quiz-img');
const quizSvg = document.getElementById('quiz-svg');
const quizRemaining = document.getElementById('quiz-remaining');
const quizBanner = document.getElementById('quiz-question-banner');
const quizAnswerArea = document.getElementById('quiz-reverse-answer');
const quizChoiceGrid = document.getElementById('quiz-choice-grid');
const quizTypingRow = document.getElementById('quiz-typing-row');
const quizTypingInput = document.getElementById('quiz-typing-input');
const quizSubmitBtn = document.getElementById('quiz-submit-btn');
const quizDontKnowBtn = document.getElementById('quiz-dontknow-btn');
const quizDoneOverlay = document.getElementById('quiz-done-overlay');
const quizDoneCloseBtn = document.getElementById('quiz-done-close-btn');
const quizResultsStats = document.getElementById('quiz-results-stats');
const quizResultsWrongList = document.getElementById('quiz-results-wronglist');
const quizRetryBtn = document.getElementById('quiz-retry-btn');
const quizRetryOppositeBtn = document.getElementById('quiz-retry-opposite-btn');

const quizRoundOverlay = document.getElementById('quiz-round-overlay');
const quizRoundText = document.getElementById('quiz-round-text');

const quizSetupSheet = document.getElementById('quiz-setup-sheet');
const quizAnswerTypeRow = document.getElementById('quiz-answer-type-row');
const quizStartBtn = document.getElementById('quiz-start-btn');

const QuizState = {
  sessionId: null,
  imageId: null,
  image: null,
  labels: [],
  queue: [],
  round: 1,
  wrongThisRound: [],
  log: [],
  direction: 'forward',
  answerType: 'choice',
  language: 'en',
  current: null,
  openIds: new Set(),
  locked: false
};

let quizSetupImageId = null;
let quizSetup = { direction: 'forward', answerType: 'choice', language: 'en' };

let zoomState = { scale: 1, tx: 0, ty: 0 };
const activePointers = new Map();
let pinchState = null;
let tapCandidate = null;

// utils

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizeAnswer(s) {
  return s.toLowerCase().replace(/[\s-]/g, '');
}

function editDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function isTypingCorrect(input, label) {
  const normInput = normalizeAnswer(input);
  const candidates = [label.textEn, label.textKo].filter(Boolean).map(normalizeAnswer);
  for (const cand of candidates) {
    if (!cand) continue;
    const threshold = cand.length <= 3 ? 0 : cand.length <= 6 ? 1 : 2;
    if (editDistance(normInput, cand) <= threshold) return true;
  }
  return false;
}

function resolveLanguage(label) {
  let lang = QuizState.language;
  if (lang === 'mixed') lang = Math.random() < 0.5 ? 'en' : 'ko';
  if (lang === 'ko' && !label.textKo) lang = 'en';
  const text = lang === 'ko' ? label.textKo : label.textEn;
  return { lang, text };
}

function oppositeDirection(d) {
  return d === 'forward' ? 'reverse' : 'forward';
}

function deriveOpenIds(log, round) {
  const s = new Set();
  for (const entry of log) {
    if (entry.round === round && entry.correct) s.add(entry.labelId);
  }
  return s;
}

// setup sheet

async function openSetup(imageId) {
  const existing = await getSessionByImage(imageId);
  if (existing) {
    await beginQuizFromSession(existing);
    return;
  }
  quizSetupImageId = imageId;
  quizSetup = { direction: 'forward', answerType: 'choice', language: 'en' };
  updateSetupUI();
  quizSetupSheet.hidden = false;
}

function updateSetupUI() {
  document.querySelectorAll('.quiz-setup-option').forEach((btn) => {
    btn.classList.toggle('active', quizSetup[btn.dataset.key] === btn.dataset.value);
  });
  quizAnswerTypeRow.hidden = quizSetup.direction !== 'reverse';
}

document.querySelectorAll('.quiz-setup-option').forEach((btn) => {
  btn.addEventListener('click', () => {
    quizSetup[btn.dataset.key] = btn.dataset.value;
    updateSetupUI();
  });
});

quizStartBtn.addEventListener('click', async () => {
  quizSetupSheet.hidden = true;
  await startNewSession(quizSetupImageId, { ...quizSetup });
});

quizRetryBtn.addEventListener('click', async () => {
  const settings = { direction: QuizState.direction, answerType: QuizState.answerType, language: QuizState.language };
  const imageId = QuizState.imageId;
  quizDoneOverlay.hidden = true;
  await startNewSession(imageId, settings);
});

quizRetryOppositeBtn.addEventListener('click', async () => {
  const settings = { direction: oppositeDirection(QuizState.direction), answerType: QuizState.answerType, language: QuizState.language };
  const imageId = QuizState.imageId;
  quizDoneOverlay.hidden = true;
  await startNewSession(imageId, settings);
});

quizDoneCloseBtn.addEventListener('click', () => {
  const deckId = QuizState.image.deckId;
  exitQuiz();
  openDeck(deckId);
});

// quiz lifecycle

async function startNewSession(imageId, settings) {
  const allLabels = (await getLabelsByImage(imageId)).filter((l) => !l.excluded);
  const session = await createSession({
    imageId,
    mode: settings.direction,
    answerType: settings.answerType,
    language: settings.language,
    round: 1,
    queue: shuffle(allLabels.map((l) => l.id)),
    wrongThisRound: [],
    log: []
  });
  await beginQuizFromSession(session);
}

async function beginQuizFromSession(session) {
  const image = await getImage(session.imageId);
  const allLabels = (await getLabelsByImage(session.imageId)).filter((l) => !l.excluded);

  QuizState.sessionId = session.id;
  QuizState.imageId = session.imageId;
  QuizState.image = image;
  QuizState.labels = allLabels;
  QuizState.queue = [...session.queue];
  QuizState.round = session.round;
  QuizState.wrongThisRound = [...session.wrongThisRound];
  QuizState.log = [...session.log];
  QuizState.direction = session.mode;
  QuizState.answerType = session.answerType;
  QuizState.language = session.language;
  QuizState.openIds = deriveOpenIds(session.log, session.round);
  QuizState.locked = false;

  showView('quiz');
  headerTitle.textContent = image.name || '퀴즈';
  resetZoom();
  quizDoneOverlay.hidden = true;
  quizRoundOverlay.hidden = true;

  try {
    await loadImageIntoEl(quizImg, image);
  } catch (err) {
    console.error(err);
    alert('사진을 불러오지 못했습니다. 이 사진을 편집 화면에서 삭제하고 다시 올려주세요.');
    const deckId = image.deckId;
    exitQuiz();
    openDeck(deckId);
    return;
  }
  quizSvg.setAttribute('viewBox', `0 0 ${image.width} ${image.height}`);

  attachQuizPointerHandlers();
  await presentState();
  fitWrapToContainer(quizWrap, quizStage, image.width, image.height);
}

async function persistSession() {
  await updateSession(QuizState.sessionId, {
    round: QuizState.round,
    queue: QuizState.queue,
    wrongThisRound: QuizState.wrongThisRound,
    log: QuizState.log
  });
}

async function recordAnswer(labelId, correct) {
  QuizState.log.push({ labelId, correct, round: QuizState.round });
  if (correct) {
    QuizState.openIds.add(labelId);
  } else {
    QuizState.wrongThisRound.push(labelId);
    const label = QuizState.labels.find((l) => l.id === labelId);
    if (label) {
      const updated = await updateLabel(labelId, { wrongCount: (label.wrongCount || 0) + 1 });
      label.wrongCount = updated.wrongCount;
    }
  }
  QuizState.queue.shift();
  await persistSession();
}

function updateRemainingText() {
  quizRemaining.textContent = QuizState.round > 1
    ? `${QuizState.round}라운드 · ${QuizState.queue.length}문제 남음`
    : `${QuizState.queue.length}문제 남음`;
}

async function presentState() {
  if (QuizState.queue.length === 0) {
    if (QuizState.wrongThisRound.length === 0) {
      await finishQuizSession();
    } else {
      await startNextRound();
    }
    return;
  }
  nextQuestion();
}

function nextQuestion() {
  QuizState.current = QuizState.queue[0];
  updateRemainingText();
  const label = QuizState.labels.find((l) => l.id === QuizState.current);
  const resolved = resolveLanguage(label);

  if (QuizState.direction === 'forward') {
    quizBanner.textContent = `${resolved.text}가 어디야?`;
    quizAnswerArea.hidden = true;
  } else {
    quizBanner.textContent = '이거 뭐야?';
    quizAnswerArea.hidden = false;
    setupReverseAnswerUI(label, resolved.lang);
  }
  renderQuizBoxes();
}

function showRoundIntro(round, count) {
  return new Promise((resolve) => {
    quizRoundText.textContent = `${round}라운드 · ${count}개 남음`;
    quizRoundOverlay.hidden = false;
    setTimeout(() => {
      quizRoundOverlay.hidden = true;
      resolve();
    }, 1400);
  });
}

async function startNextRound() {
  QuizState.round += 1;
  QuizState.queue = shuffle([...QuizState.wrongThisRound]);
  QuizState.wrongThisRound = [];
  QuizState.openIds = new Set();
  await persistSession();
  renderQuizBoxes();
  await showRoundIntro(QuizState.round, QuizState.queue.length);
  await presentState();
}

async function finishQuizSession() {
  quizBanner.textContent = '';
  quizAnswerArea.hidden = true;
  quizRemaining.textContent = '완료';
  renderQuizBoxes();

  const round1Entries = QuizState.log.filter((e) => e.round === 1);
  const round1Correct = round1Entries.filter((e) => e.correct).length;
  const round1Accuracy = round1Entries.length > 0 ? Math.round((round1Correct / round1Entries.length) * 100) : 0;

  const wrongCounts = {};
  for (const e of QuizState.log) {
    if (!e.correct) wrongCounts[e.labelId] = (wrongCounts[e.labelId] || 0) + 1;
  }
  const wrongList = Object.entries(wrongCounts)
    .map(([labelId, count]) => {
      const label = QuizState.labels.find((l) => l.id === Number(labelId));
      return { name: label ? label.textEn : '?', count };
    })
    .sort((a, b) => b.count - a.count);

  await deleteSession(QuizState.sessionId);
  QuizState.sessionId = null;

  renderResultsScreen({ round1Accuracy, totalRounds: QuizState.round, wrongList });
}

function renderResultsScreen({ round1Accuracy, totalRounds, wrongList }) {
  quizResultsStats.innerHTML = '';
  const p1 = document.createElement('p');
  p1.textContent = `1라운드 정답률 ${round1Accuracy}% · 총 ${totalRounds}라운드`;
  quizResultsStats.appendChild(p1);

  quizResultsWrongList.innerHTML = '';
  if (wrongList.length === 0) {
    const p = document.createElement('p');
    p.textContent = '한 번도 틀리지 않았어요!';
    quizResultsWrongList.appendChild(p);
  } else {
    for (const w of wrongList) {
      const row = document.createElement('div');
      row.className = 'quiz-results-row';
      row.textContent = `${w.name} · ${w.count}회`;
      quizResultsWrongList.appendChild(row);
    }
  }
  quizDoneOverlay.hidden = false;
}

function exitQuiz() {
  detachQuizPointerHandlers();
  quizSetupSheet.hidden = true;
  quizDoneOverlay.hidden = true;
  quizRoundOverlay.hidden = true;
  quizSvg.innerHTML = '';
  QuizState.sessionId = null;
  QuizState.imageId = null;
  QuizState.current = null;
  QuizState.locked = false;
}

// rendering

function renderQuizBoxes() {
  quizSvg.innerHTML = '';
  for (const label of QuizState.labels) {
    if (QuizState.openIds.has(label.id)) continue;
    const classes = ['label-box', 'preview'];
    if (QuizState.direction === 'reverse' && label.id === QuizState.current) classes.push('quiz-target');
    quizSvg.appendChild(svgEl('rect', { x: label.x, y: label.y, width: label.w, height: label.h, class: classes.join(' '), 'data-id': label.id }));
  }
}

function flashBox(labelId, className, duration, nameText) {
  return new Promise((resolve) => {
    renderQuizBoxes();
    const rect = quizSvg.querySelector(`rect[data-id="${labelId}"]`);
    let textEl = null;
    if (rect) {
      rect.classList.add(className);
      if (nameText) {
        textEl = svgEl('text', { x: Number(rect.getAttribute('x')), y: Number(rect.getAttribute('y')) - 10, class: 'quiz-name-popup' });
        textEl.textContent = nameText;
        quizSvg.appendChild(textEl);
      }
    }
    setTimeout(() => {
      if (rect) rect.classList.remove(className);
      if (textEl) textEl.remove();
      resolve();
    }, duration);
  });
}

// forward mode: tap-to-answer

function clientToImageQuiz(clientX, clientY) {
  const rect = quizSvg.getBoundingClientRect();
  const vb = quizSvg.viewBox.baseVal;
  const scale = vb.width / rect.width;
  return { x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale };
}

function handleQuizTap(clientX, clientY) {
  if (QuizState.direction !== 'forward' || QuizState.locked) return;
  const pt = clientToImageQuiz(clientX, clientY);
  let best = null, bestDist = Infinity;
  for (const label of QuizState.labels) {
    if (QuizState.openIds.has(label.id)) continue;
    const x0 = label.x - HIT_TOLERANCE_PX, y0 = label.y - HIT_TOLERANCE_PX;
    const x1 = label.x + label.w + HIT_TOLERANCE_PX, y1 = label.y + label.h + HIT_TOLERANCE_PX;
    if (pt.x >= x0 && pt.x <= x1 && pt.y >= y0 && pt.y <= y1) {
      const cx = label.x + label.w / 2, cy = label.y + label.h / 2;
      const d = Math.hypot(pt.x - cx, pt.y - cy);
      if (d < bestDist) { bestDist = d; best = label; }
    }
  }
  if (best) submitForwardAnswer(best);
}

async function submitForwardAnswer(tappedLabel) {
  QuizState.locked = true;
  const correct = tappedLabel.id === QuizState.current;
  if (correct) {
    await flashBox(tappedLabel.id, 'feedback-correct', 450);
  } else {
    await flashBox(tappedLabel.id, 'feedback-wrong', 900, tappedLabel.textEn);
    await flashBox(QuizState.current, 'feedback-correct-hint', 900);
  }
  await recordAnswer(QuizState.current, correct);
  QuizState.locked = false;
  await presentState();
}

// reverse mode: name-the-label

function setupReverseAnswerUI(label, lang) {
  quizChoiceGrid.innerHTML = '';
  quizTypingInput.value = '';
  if (QuizState.answerType === 'choice') {
    quizChoiceGrid.hidden = false;
    quizTypingRow.hidden = true;
    const options = buildChoices(label, lang);
    for (const opt of options) {
      const btn = document.createElement('button');
      btn.className = 'quiz-choice-btn';
      btn.textContent = opt.text;
      btn.dataset.labelId = opt.labelId;
      btn.addEventListener('click', () => submitReverseChoice(opt.labelId, btn));
      quizChoiceGrid.appendChild(btn);
    }
  } else {
    quizChoiceGrid.hidden = true;
    quizTypingRow.hidden = false;
    setTimeout(() => quizTypingInput.focus(), 50);
  }
}

function buildChoices(label, lang) {
  const pool = QuizState.labels.filter((l) => l.id !== label.id);
  shuffle(pool);
  const distractors = pool.slice(0, Math.min(3, pool.length));
  const options = [label, ...distractors].map((l) => ({
    labelId: l.id,
    text: lang === 'ko' && l.textKo ? l.textKo : l.textEn
  }));
  return shuffle(options);
}

async function submitReverseChoice(labelId, btnEl) {
  if (QuizState.locked) return;
  QuizState.locked = true;
  const correct = labelId === QuizState.current;
  if (correct) {
    btnEl.classList.add('choice-correct');
  } else {
    btnEl.classList.add('choice-wrong');
    const correctBtn = Array.from(quizChoiceGrid.querySelectorAll('.quiz-choice-btn')).find((b) => Number(b.dataset.labelId) === QuizState.current);
    if (correctBtn) correctBtn.classList.add('choice-correct');
  }
  await flashBox(QuizState.current, correct ? 'feedback-correct' : 'feedback-correct-hint', 900);
  await recordAnswer(QuizState.current, correct);
  QuizState.locked = false;
  await presentState();
}

async function submitReverseTyping() {
  if (QuizState.locked) return;
  const input = quizTypingInput.value.trim();
  if (!input) return;
  const label = QuizState.labels.find((l) => l.id === QuizState.current);
  QuizState.locked = true;
  const correct = isTypingCorrect(input, label);
  await flashBox(QuizState.current, correct ? 'feedback-correct' : 'feedback-correct-hint', 900, correct ? null : label.textEn);
  await recordAnswer(QuizState.current, correct);
  QuizState.locked = false;
  await presentState();
}

quizSubmitBtn.addEventListener('click', submitReverseTyping);
quizTypingInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitReverseTyping();
});

quizDontKnowBtn.addEventListener('click', async () => {
  if (QuizState.locked) return;
  const label = QuizState.labels.find((l) => l.id === QuizState.current);
  QuizState.locked = true;
  await flashBox(QuizState.current, 'feedback-correct-hint', 900, label.textEn);
  await recordAnswer(QuizState.current, false);
  QuizState.locked = false;
  await presentState();
});

// pinch zoom + pan (quiz stage only)

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function applyZoomTransform() {
  quizWrap.style.transform = `translate(${zoomState.tx}px, ${zoomState.ty}px) scale(${zoomState.scale})`;
  quizWrap.style.transformOrigin = '0 0';
}

function resetZoom() {
  zoomState = { scale: 1, tx: 0, ty: 0 };
  applyZoomTransform();
}

function attachQuizPointerHandlers() {
  quizStage.addEventListener('pointerdown', onQuizPointerDown);
  window.addEventListener('pointermove', onQuizPointerMove);
  window.addEventListener('pointerup', onQuizPointerUp);
  window.addEventListener('pointercancel', onQuizPointerUp);
}

function detachQuizPointerHandlers() {
  quizStage.removeEventListener('pointerdown', onQuizPointerDown);
  window.removeEventListener('pointermove', onQuizPointerMove);
  window.removeEventListener('pointerup', onQuizPointerUp);
  window.removeEventListener('pointercancel', onQuizPointerUp);
  activePointers.clear();
  pinchState = null;
  tapCandidate = null;
}

function onQuizPointerDown(e) {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size === 1) {
    tapCandidate = { pointerId: e.pointerId, startClient: { x: e.clientX, y: e.clientY }, moved: false };
  } else {
    tapCandidate = null;
    const pts = Array.from(activePointers.values());
    pinchState = { lastDist: dist(pts[0], pts[1]) };
  }
}

function onQuizPointerMove(e) {
  if (!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (activePointers.size >= 2 && pinchState) {
    const pts = Array.from(activePointers.values());
    const newDist = dist(pts[0], pts[1]);
    const newMid = mid(pts[0], pts[1]);
    const rect = quizWrap.getBoundingClientRect();
    if (rect.width && rect.height && pinchState.lastDist) {
      const fracX = (newMid.x - rect.left) / rect.width;
      const fracY = (newMid.y - rect.top) / rect.height;
      const newScale = clamp(zoomState.scale * (newDist / pinchState.lastDist), MIN_ZOOM, MAX_ZOOM);
      const scaleRatio = newScale / zoomState.scale;
      const newW = rect.width * scaleRatio;
      const newH = rect.height * scaleRatio;
      zoomState.tx += newMid.x - fracX * newW - rect.left;
      zoomState.ty += newMid.y - fracY * newH - rect.top;
      zoomState.scale = newScale;
      applyZoomTransform();
    }
    pinchState.lastDist = newDist;
  } else if (tapCandidate && e.pointerId === tapCandidate.pointerId) {
    const dx = e.clientX - tapCandidate.startClient.x;
    const dy = e.clientY - tapCandidate.startClient.y;
    if (Math.hypot(dx, dy) > TAP_THRESHOLD_QUIZ) tapCandidate.moved = true;
  }
}

function onQuizPointerUp(e) {
  activePointers.delete(e.pointerId);
  if (tapCandidate && e.pointerId === tapCandidate.pointerId) {
    if (!tapCandidate.moved) handleQuizTap(e.clientX, e.clientY);
    tapCandidate = null;
  }
  if (activePointers.size < 2) pinchState = null;
}

window.Quiz = { openSetup, exit: exitQuiz };
