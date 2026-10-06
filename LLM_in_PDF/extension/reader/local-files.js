import { digest } from '../shared/documents.js';

async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('paper-read-documents', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pdfs', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function storeAction(mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('pdfs', mode);
      const request = action(transaction.objectStore('pdfs'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('本地文件保存失败'));
    });
  } finally { db.close(); }
}
export async function localInfo(bytes, name) {
  if (bytes.byteLength > 100 * 1024 * 1024) throw new Error('PDF 超过 100 MB，请选择较小的文件。');
  if (!new TextDecoder('latin1').decode(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 1024))).includes('%PDF-')) throw new Error('文件不是有效的 PDF。');
  return { id: `local:${await digest(bytes)}`, title: name || '本地论文.pdf', label: `本地 PDF · ${name || '论文'}`, source: 'local-pdf' };
}
export async function importFile(file) {
  if (file.size > 100 * 1024 * 1024) throw new Error('PDF 超过 100 MB，请选择较小的文件。');
  const bytes = await file.arrayBuffer();
  const info = await localInfo(bytes, file.name);
  await storeAction('readwrite', (store) => store.put({ ...info, bytes, at: Date.now() }));
  return info;
}
export function getLocal(id) { return storeAction('readonly', (store) => store.get(id)); }
export function removeLocal(id) { return storeAction('readwrite', (store) => store.delete(id)); }
export async function listLocal() {
  // Cursors avoid reading all saved PDF bytes into memory merely to list names.
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const list = [], tx = db.transaction('pdfs'), request = tx.objectStore('pdfs').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const { id, title, at } = cursor.value; list.push({ id, title, at }); cursor.continue();
      };
      tx.oncomplete = () => resolve(list.sort((a, b) => b.at - a.at));
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
