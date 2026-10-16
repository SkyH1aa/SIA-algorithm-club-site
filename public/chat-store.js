let database;
function open() {
  if (!database) database = new Promise((resolve,reject) => {
    const request = indexedDB.open('club-ai-chat',1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('conversations',{keyPath:['userId','id']});
      store.createIndex('userId','userId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
    request.onblocked = () => { database = null; reject(new Error('storage')); };
  });
  return database;
}
async function transaction(mode, operation) {
  const db = await open();
  return new Promise((resolve,reject) => {
    const tx = db.transaction('conversations',mode);
    let value;
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('storage'));
    operation(tx.objectStore('conversations'), result => { value = result; });
  });
}
export const chatStore = {
  list(userId) { return transaction('readonly',(store,done) => { const r=store.index('userId').getAll(userId); r.onsuccess=()=>done(r.result.sort((a,b)=>b.updatedAt-a.updatedAt)); }); },
  save(conversation) { return transaction('readwrite',store=>store.put(conversation)); },
  delete(userId,id) { return transaction('readwrite',store=>store.delete([userId,id])); },
  clear(userId) { return transaction('readwrite',store=>{ const r=store.index('userId').openKeyCursor(userId); r.onsuccess=()=>{ const cursor=r.result; if(cursor){store.delete(cursor.primaryKey);cursor.continue();} }; }); }
};
