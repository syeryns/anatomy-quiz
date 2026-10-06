const DB_NAME = 'anatomy-quiz-db';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('decks')) {
        db.createObjectStore('decks', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('images')) {
        const store = db.createObjectStore('images', { keyPath: 'id', autoIncrement: true });
        store.createIndex('deckId', 'deckId');
      }
      if (!db.objectStoreNames.contains('labels')) {
        const store = db.createObjectStore('labels', { keyPath: 'id', autoIncrement: true });
        store.createIndex('imageId', 'imageId');
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const store = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        store.createIndex('imageId', 'imageId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getDB() {
  if (!dbPromise) dbPromise = openDB();
  return dbPromise;
}

function reqPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await getDB();
  const t = db.transaction(storeName, mode);
  const store = t.objectStore(storeName);
  const result = await fn(store);
  await new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  return result;
}

// decks

async function createDeck(name) {
  return withStore('decks', 'readwrite', async (store) => {
    const deck = { name, createdAt: Date.now(), maskSettings: { mode: 'padded', padding: 10 } };
    const id = await reqPromise(store.add(deck));
    return { id, ...deck };
  });
}

async function getAllDecks() {
  return withStore('decks', 'readonly', (store) => reqPromise(store.getAll()));
}

async function getDeck(id) {
  return withStore('decks', 'readonly', (store) => reqPromise(store.get(id)));
}

async function renameDeck(id, name) {
  return withStore('decks', 'readwrite', async (store) => {
    const deck = await reqPromise(store.get(id));
    deck.name = name;
    await reqPromise(store.put(deck));
    return deck;
  });
}

async function deleteDeck(id) {
  const images = await getImagesByDeck(id);
  for (const image of images) {
    await deleteImage(image.id);
  }
  return withStore('decks', 'readwrite', (store) => reqPromise(store.delete(id)));
}

async function updateDeckMaskSettings(id, maskSettings) {
  return withStore('decks', 'readwrite', async (store) => {
    const deck = await reqPromise(store.get(id));
    deck.maskSettings = maskSettings;
    await reqPromise(store.put(deck));
    return deck;
  });
}

// images
//
// Image bytes are stored as an ArrayBuffer + mimeType rather than a Blob.
// Safari/WebKit has a long-standing IndexedDB bug where a Blob written to
// a store can come back corrupted (0 bytes / wrong type) on a later, separate
// read — it tends to work right after writing (e.g. the editor, opened in the
// same flow as OCR) but fail on a subsequent cold read (e.g. the quiz, opened
// after navigating away and back). Storing raw bytes sidesteps that bug.

async function addImage(deckId, blob, width, height, name) {
  const data = await blob.arrayBuffer();
  const mimeType = blob.type || 'image/jpeg';
  return withStore('images', 'readwrite', async (store) => {
    const image = { deckId, data, mimeType, width, height, name, ocrDone: false, confirmed: false, createdAt: Date.now() };
    const id = await reqPromise(store.add(image));
    return { id, ...image };
  });
}

function imageToBlob(image) {
  if (image.blob) return image.blob; // backward compat with images saved before this fix
  return new Blob([image.data], { type: image.mimeType || 'image/jpeg' });
}

async function getImagesByDeck(deckId) {
  return withStore('images', 'readonly', (store) => reqPromise(store.index('deckId').getAll(deckId)));
}

async function getImage(id) {
  return withStore('images', 'readonly', (store) => reqPromise(store.get(id)));
}

async function updateImage(id, changes) {
  return withStore('images', 'readwrite', async (store) => {
    const image = await reqPromise(store.get(id));
    Object.assign(image, changes);
    await reqPromise(store.put(image));
    return image;
  });
}

async function deleteImage(id) {
  await deleteLabelsByImage(id);
  return withStore('images', 'readwrite', (store) => reqPromise(store.delete(id)));
}

// labels

async function addLabels(imageId, labels) {
  return withStore('labels', 'readwrite', async (store) => {
    const saved = [];
    for (const label of labels) {
      const record = { imageId, ...label };
      const id = await reqPromise(store.add(record));
      saved.push({ id, ...record });
    }
    return saved;
  });
}

async function getLabelsByImage(imageId) {
  return withStore('labels', 'readonly', (store) => reqPromise(store.index('imageId').getAll(imageId)));
}

async function addLabel(imageId, label) {
  return withStore('labels', 'readwrite', async (store) => {
    const record = { imageId, ...label };
    const id = await reqPromise(store.add(record));
    return { id, ...record };
  });
}

async function updateLabel(id, changes) {
  return withStore('labels', 'readwrite', async (store) => {
    const label = await reqPromise(store.get(id));
    Object.assign(label, changes);
    await reqPromise(store.put(label));
    return label;
  });
}

async function deleteLabel(id) {
  return withStore('labels', 'readwrite', (store) => reqPromise(store.delete(id)));
}

async function deleteLabelsByImage(imageId) {
  return withStore('labels', 'readwrite', async (store) => {
    const idx = store.index('imageId');
    const keys = await reqPromise(idx.getAllKeys(imageId));
    for (const key of keys) {
      await reqPromise(store.delete(key));
    }
  });
}

// sessions

async function createSession(session) {
  return withStore('sessions', 'readwrite', async (store) => {
    const id = await reqPromise(store.add(session));
    return { id, ...session };
  });
}

async function updateSession(id, changes) {
  return withStore('sessions', 'readwrite', async (store) => {
    const session = await reqPromise(store.get(id));
    Object.assign(session, changes);
    await reqPromise(store.put(session));
    return session;
  });
}

async function getSessionByImage(imageId) {
  return withStore('sessions', 'readonly', async (store) => {
    const all = await reqPromise(store.index('imageId').getAll(imageId));
    return all[0] || null;
  });
}

async function deleteSession(id) {
  return withStore('sessions', 'readwrite', (store) => reqPromise(store.delete(id)));
}
