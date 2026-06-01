// ----------------- データ管理 -----------------
let deletedCards = [];
let deletedCats = [];

function loadData() {
  try { 
    const raw=localStorage.getItem(STORAGE_KEY); 
    if(raw){ 
      const p=JSON.parse(raw); 
      if(p.db) db=p.db; 
      if(p.categories) categories=p.categories; 
      if(p.categoryTree) categoryTree=p.categoryTree; 
      if(p.subscribedDocs) subscribedDocs=p.subscribedDocs; 
      if(p.deletedCards) deletedCards=p.deletedCards;
      if(p.deletedCats) deletedCats=p.deletedCats;
    } 
  } catch(e){}
  try { shareStats = localStorage.getItem('shareStats') === 'true'; } catch(e){}
}

function saveData(immediate = false) {
  ensureSystemSanity();
  const payload = { db, categories, categoryTree, subscribedDocs, deletedCards, deletedCats };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  if (currentUser) {
    clearTimeout(syncTimeout);
    setSyncStatus('saving', '🔄 保存中...');
    if (immediate) {
      backgroundCloudSave(payload);
    } else {
      syncTimeout = setTimeout(() => backgroundCloudSave(payload), 1000);
    }
  }
}

function setSyncStatus(state, text) {
  const el = document.getElementById('cloudSyncStatus');
  if(!el) return;
  el.className = `sync-status ${state}`;
  el.innerText = text;
  if (state === 'success' || state === 'error') setTimeout(() => el.classList.add('hidden'), 3000);
}

async function backgroundCloudSave(payload) {
  try {
    await firestore.collection("susuru_anki_users").doc(currentUser.uid).set({
      version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : "unknown", 
      db: payload.db, categories: payload.categories,
      categoryTree: payload.categoryTree, subscribedDocs: payload.subscribedDocs, 
      deletedCards: payload.deletedCards || [], deletedCats: payload.deletedCats || [],
      lastSync: firebase.firestore.FieldValue.serverTimestamp()
    });
    setSyncStatus('success', '✅ 保存完了');
  } catch (err) { setSyncStatus('error', '⚠️ 保存エラー'); }
}

function ensureSystemSanity() {
  for (let parent in categoryTree) { if (!categories.includes(parent)) categories.push(parent); }
  if (!categories.includes("未分類")) categories.push("未分類");
  categories = [...new Set(categories.filter(c => c && c.trim() !== ""))];

  const activeCatsInTree = new Set();
  for (let p in categoryTree) { (categoryTree[p] || []).forEach(c => activeCatsInTree.add(c)); }
  categories = categories.filter(c => activeCatsInTree.has(c) || getTopLevelCategories().includes(c));

  db = db.filter(i => i && i.question && i.question.toString().trim() !== "" && i.answer && i.answer.toString().trim() !== "");
  db.forEach(item => {
    if(!item.id) item.id = 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    if(!item.category || !categories.includes(item.category)) {
      item.category = item.group && categories.includes(item.group) ? item.group : "未分類";
    }
    if(item.level === undefined) item.level = 0;
    if(item.correct === undefined) item.correct = 0;
    if(item.incorrect === undefined) item.incorrect = 0;
    if(item.streak === undefined) item.streak = 0;
    if(item.wrongStreak === undefined) item.wrongStreak = 0;
    if(item.shikkariStreak === undefined) item.shikkariStreak = 0;
  });
}

function autoMerge() {
  let mergedMap = new Map();
  db.forEach(item => {
    let safeCat = item.category ? String(item.category).trim() : "未分類";
    let key = `${safeCat}_${String(item.question).trim()}_${String(item.answer).trim()}`;
    if (!mergedMap.has(key)) { mergedMap.set(key, JSON.parse(JSON.stringify(item))); } 
    else {
      let ext = mergedMap.get(key);
      ext.correct = (Number(ext.correct)||0) + (Number(item.correct)||0);
      ext.incorrect = (Number(ext.incorrect)||0) + (Number(item.incorrect)||0);
      ext.level = Math.max(Number(ext.level)||0, Number(item.level)||0);
      ext.streak = Math.max(Number(ext.streak)||0, Number(item.streak)||0);
      ext.wrongStreak = Math.max(Number(ext.wrongStreak)||0, Number(item.wrongStreak)||0);
      ext.shikkariStreak = Math.max(Number(ext.shikkariStreak)||0, Number(item.shikkariStreak)||0);
      if(item.sharedDocId) ext.sharedDocId = item.sharedDocId;
    }
  });
  db = Array.from(mergedMap.values());
  saveData();
}

async function syncToCloud(isSilent = false) {
  if (!currentUser) { if (!isSilent) alert("Googleアカウントでログインしてください。"); return; }
  try {
    const ref = firestore.collection("susuru_anki_users").doc(currentUser.uid);
    const snap = await ref.get();
    if (snap.exists) {
      let r = snap.data();
      if (r.subscribedDocs) subscribedDocs = r.subscribedDocs;
      
      if (r.deletedCards) { r.deletedCards.forEach(id => { if (!deletedCards.includes(id)) deletedCards.push(id); }); }
      if (r.deletedCats) { r.deletedCats.forEach(c => { if (!deletedCats.includes(c)) deletedCats.push(c); }); }
      
      // ★ 修正箇所: クラウドのデータを「正」としてローカルを完全上書き一掃する
      if (Array.isArray(r.db)) {
        let nextDb = [];
        r.db.forEach(rq => {
          if (!rq.question || !rq.answer) return;
          if (!deletedCards.includes(rq.id)) {
            // 成績だけはローカルが進んでいれば引き継ぐ
            let lq = db.find(q => q.id === rq.id);
            if (lq && (lq.level > rq.level || lq.correct > rq.correct || lq.streak > rq.streak)) {
              nextDb.push(lq);
            } else {
              nextDb.push(rq);
            }
          }
        });
        // クラウド保存に間に合っていない、ローカルで作りたての新規カードだけ救済
        db.forEach(lq => {
          if (!nextDb.find(q => q.id === lq.id) && !deletedCards.includes(lq.id)) {
             nextDb.push(lq);
          }
        });
        db = nextDb;
      }
      
      let nextCategories = ["未分類"];
      let rCat = r.categories || [];
      rCat.forEach(rc => { if (rc && !nextCategories.includes(rc) && !deletedCats.includes(rc)) nextCategories.push(rc); });
      categories = nextCategories;

      let nextCategoryTree = {};
      let rTree = r.categoryTree || {};
      for (let p in rTree) {
        if (!categories.includes(p) && !deletedCats.includes(p)) categories.push(p);
        if (!nextCategoryTree[p]) nextCategoryTree[p] = [];
        rTree[p].forEach(c => { if (!nextCategoryTree[p].includes(c) && !deletedCats.includes(c)) nextCategoryTree[p].push(c); });
      }
      categoryTree = nextCategoryTree;
    }
    ensureSystemSanity();
    autoMerge();
    
    await ref.set({ 
      version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : "unknown", 
      db, categories, categoryTree, subscribedDocs, deletedCards, deletedCats, lastSync: firebase.firestore.FieldValue.serverTimestamp() 
    });
    if (document.getElementById('pgTree').classList.contains('active')) renderTree();
    if (document.getElementById('pgBox').classList.contains('active')) renderBox();
    
    if (typeof syncSubscriptions === 'function') await syncSubscriptions();
    
    if (!isSilent) { alert(`☁️ 同期完了！`); openPage('pgHome'); }
  } catch (err) { if (!isSilent) alert(`⚠️ 同期エラー: ${err.message}\n(Firebaseのルール設定などを確認してください)`); }
}
