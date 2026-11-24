// Image history is deliberately separate from the general chat database.
export function createImageStore(name = 'club-ai-images') {
  let connection;

  function storageError(error) {
    return new Error(`Image storage: ${error?.message || error?.name || 'operation failed'}`, {cause: error});
  }

  function open() {
    if (connection) return connection;
    let promise;
    promise = new Promise((resolve, reject) => {
      let request;
      let failed = false;
      const fail = error => {
        failed = true;
        if (connection === promise) connection = null;
        reject(storageError(error));
      };
      try {
        request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          const records = db.createObjectStore('records', {keyPath: ['userId', 'id']});
          records.createIndex('timeline', ['userId', 'createdAt', 'id']);
          records.createIndex('pending', ['userId', '_archivePendingKey', 'createdAt', 'id']);
          db.createObjectStore('assets', {keyPath: ['userId', 'recordId', 'assetId']});
        };
        request.onerror = () => fail(request.error);
        request.onblocked = () => fail(new Error('opening database blocked by another connection'));
        request.onsuccess = () => {
          const db = request.result;
          if (failed) { db.close(); return; }
          db.onversionchange = () => {
            db.close();
            if (connection === promise) connection = null;
          };
          db.onclose = () => { if (connection === promise) connection = null; };
          resolve(db);
        };
      } catch (error) { fail(error); }
    });
    connection = promise;
    // Synchronous open failures can occur before the promise is assigned above.
    promise.catch(() => { if (connection === promise) connection = null; });
    return promise;
  }

  async function transaction(stores, mode, operation) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let tx;
      let result;
      let operationError;
      try {
        tx = db.transaction(stores, mode);
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(storageError(operationError || tx.error || new Error('transaction aborted')));
        // The abort event supplies the final transaction error, including quota errors.
        tx.onerror = () => {};
        operation(tx, value => { result = value; });
      } catch (error) {
        operationError = error;
        if (tx) {
          try { tx.abort(); } catch { reject(storageError(error)); }
        } else reject(storageError(error));
      }
    });
  }

  function requireId(value, label) {
    if (typeof value !== 'string' || !value) throw new TypeError(`${label} must be a non-empty string`);
  }
  function limitValue(value, fallback) {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('limit must be a positive integer');
    return value;
  }
  function publicRecord(record) {
    if (!record) return null;
    const {_archivePendingKey, ...metadata} = record;
    return metadata;
  }
  function userRange(userId) {
    return IDBKeyRange.bound([userId], [userId, []], false, true);
  }
  function assetRange(userId, recordId) {
    return IDBKeyRange.bound([userId, recordId], [userId, recordId, []], false, true);
  }
  function clean(value, seen = new WeakSet()) {
    if (value instanceof Blob) return undefined;
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) throw new TypeError('record metadata must not contain cycles');
    // Preserve structured-cloneable non-plain values such as Date and ArrayBuffer.
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;
    seen.add(value);
    const result = Array.isArray(value) ? [] : {};
    for (const [key, item] of Object.entries(value)) {
      if (item instanceof Blob || key === '_archivePendingKey') continue;
      result[key] = clean(item, seen);
    }
    seen.delete(value);
    return result;
  }
  function deleteCursor(store, range) {
    const request = store.openKeyCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); }
    };
  }

  return {
    async list(userId, {before = null, limit = 30} = {}) {
      requireId(userId, 'userId');
      limit = limitValue(limit, 30);
      if (before !== null && (!Number.isFinite(before.createdAt) || typeof before.id !== 'string' || !before.id)) throw new TypeError('before must contain createdAt and id');
      return transaction(['records'], 'readonly', (tx, done) => {
        const index = tx.objectStore('records').index('timeline');
        const range = before ? IDBKeyRange.bound([userId], [userId, before.createdAt, before.id], false, true) : userRange(userId);
        const records = [];
        const result = {records, nextCursor: null, total: 0};
        const count = index.count(userRange(userId));
        count.onsuccess = () => { result.total = count.result; };
        const request = index.openCursor(range, 'prev');
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor && records.length < limit) {
            records.push(publicRecord(cursor.value));
            cursor.continue();
          } else {
            const last = records[records.length - 1];
            result.nextCursor = cursor && last ? {createdAt: last.createdAt, id: last.id} : null;
            done(result);
          }
        };
      });
    },
    async get(userId, id) {
      requireId(userId, 'userId'); requireId(id, 'id');
      return transaction(['records'], 'readonly', (tx, done) => {
        const request = tx.objectStore('records').get([userId, id]);
        request.onsuccess = () => done(publicRecord(request.result));
      });
    },
    async save(record) {
      if (!record || typeof record !== 'object') throw new TypeError('record is required');
      requireId(record.userId, 'userId'); requireId(record.id, 'id');
      if (!Number.isFinite(record.createdAt)) throw new TypeError('createdAt must be epoch milliseconds');
      const metadata = clean(record);
      const assets = [];
      for (const [field, prefix] of [['references', 'reference'], ['images', 'image']]) {
        if (record[field] === undefined) continue;
        if (!Array.isArray(record[field])) throw new TypeError(`${field} must be an array`);
        record[field].forEach((item, index) => {
          if (!item || typeof item !== 'object' || item instanceof Blob) throw new TypeError(`${field} entries must be objects`);
          const assetId = item.assetId ?? `${prefix}-${field === 'images' ? (item.slot ?? index) : index}`;
          requireId(assetId, 'assetId');
          metadata[field][index].assetId = assetId;
          if (item.blob !== undefined && item.blob !== null) {
            if (!(item.blob instanceof Blob)) throw new TypeError(`${field} blob must be a Blob`);
            assets.push({userId: record.userId, recordId: record.id, assetId, blob: item.blob});
          }
        });
      }
      metadata.archivePending = record.archivePending === true;
      return transaction(['records', 'assets'], 'readwrite', (tx, done) => {
        const assetStore = tx.objectStore('assets');
        for (const asset of assets) assetStore.put(asset);
        tx.objectStore('records').put({...metadata, _archivePendingKey: metadata.archivePending ? 1 : 0});
        done(metadata);
      });
    },
    async getAsset(userId, recordId, assetId) {
      requireId(userId, 'userId'); requireId(recordId, 'recordId'); requireId(assetId, 'assetId');
      return transaction(['assets'], 'readonly', (tx, done) => {
        const request = tx.objectStore('assets').get([userId, recordId, assetId]);
        request.onsuccess = () => done(request.result?.blob ?? null);
      });
    },
    async delete(userId, id) {
      requireId(userId, 'userId'); requireId(id, 'id');
      return transaction(['records', 'assets'], 'readwrite', tx => {
        tx.objectStore('records').delete([userId, id]);
        deleteCursor(tx.objectStore('assets'), assetRange(userId, id));
      });
    },
    async deleteMany(userId, ids) {
      requireId(userId, 'userId');
      if (!Array.isArray(ids)) throw new TypeError('ids must be an array');
      for (const id of ids) requireId(id, 'id');
      if (!ids.length) return;
      return transaction(['records', 'assets'], 'readwrite', tx => {
        const records = tx.objectStore('records');
        const assets = tx.objectStore('assets');
        for (const id of new Set(ids)) {
          records.delete([userId, id]);
          deleteCursor(assets, assetRange(userId, id));
        }
      });
    },
    async clear(userId) {
      requireId(userId, 'userId');
      return transaction(['records', 'assets'], 'readwrite', tx => {
        deleteCursor(tx.objectStore('records'), userRange(userId));
        deleteCursor(tx.objectStore('assets'), userRange(userId));
      });
    },
    async pending(userId, {limit = 20} = {}) {
      requireId(userId, 'userId'); limit = limitValue(limit, 20);
      return transaction(['records'], 'readonly', (tx, done) => {
        const records = [];
        const range = IDBKeyRange.bound([userId, 1], [userId, 1, []], false, true);
        const request = tx.objectStore('records').index('pending').openCursor(range);
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor && records.length < limit) {
            records.push(publicRecord(cursor.value));
            cursor.continue();
          } else done(records);
        };
      });
    }
  };
}

export const imageStore = createImageStore();
