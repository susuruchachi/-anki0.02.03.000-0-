// ----------------- 共有・ライブ同期カテゴリー -----------------
let currentSharedDocId = null, currentSharedData = null, unsubscribeShared = null;

// ★ フレンドの表示名キャッシュ＆読み込みフラグ
let sharedFriendsLoaded = false;
let friendNameCache = {}; // { UID: "表示名" }

// ★ 定期同期＆起動時同期ロジック
async function syncSubscriptions() {
  if (!currentUser) return;
  if (!subscribedDocs || subscribedDocs.length === 0) return;
  
  let changed = false;
  for (let docId of subscribedDocs) {
    try {
      const snap = await firestore.collection("susuru_anki_shared").doc(docId).get();
      if (!snap.exists) continue;
      const data = snap.data();
      const canEdit = (data.ownerId === currentUser.uid) || (data.friends && data.friends.includes(currentUser.uid));
      sharedDocPermissions[docId] = { canEdit };
      
      const cloudCards = data.cards || [];
      const cloudCardIds = cloudCards.map(c => c.id);
      
      // 1. クラウドから削除されたカードをローカルからも消す（成績も消えます）
      const initialLen = db.length;
      db = db.filter(q => !(q.sharedDocId === docId && !cloudCardIds.includes(q.id)));
      if (db.length !== initialLen) changed = true;
      
      // 2. クラウドの更新をローカルに反映・新規追加
      cloudCards.forEach(cq => {
        let lq = db.find(q => q.id === cq.id);
        if (lq) {
          if (lq.question !== cq.question || lq.answer !== cq.answer || lq.category !== cq.category) {
            lq.question = cq.question; lq.answer = cq.answer; lq.category = cq.category; changed = true;
          }
          if (lq.sharedDocId !== docId) { lq.sharedDocId = docId; changed = true; }
        } else {
          db.push({ id: cq.id, question: cq.question, answer: cq.answer, category: cq.category, sharedDocId: docId, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 });
          changed = true;
        }
      });
      
      // 3. カテゴリー構造の同期
      (data.categories || []).forEach(c => { if(!categories.includes(c)) { categories.push(c); changed = true; } });
      for (let p in (data.categoryTree || {})) {
        if (!categoryTree[p]) categoryTree[p] = [];
        (data.categoryTree[p] || []).forEach(c => { if (!categoryTree[p].includes(c)) { categoryTree[p].push(c); changed = true; } });
      }
    } catch (e) { console.warn("Sync error for doc:", docId, e); }
  }
  
  if (changed) {
    autoMerge();
    if (document.getElementById('pgBox').classList.contains('active')) renderBox();
    if (document.getElementById('pgTree').classList.contains('active')) renderTree();
  }
}

// ★ ローカルの編集・追加・削除をクラウドに同期するヘルパー関数
async function updateCardInSharedDoc(docId, card, action) {
  if (!currentUser) return;
  try {
    const snap = await firestore.collection("susuru_anki_shared").doc(docId).get();
    if (!snap.exists) return;
    const data = snap.data();
    let newCards = [...data.cards];
    if (action === 'edit') {
       const idx = newCards.findIndex(c => c.id === card.id);
       if (idx !== -1) { newCards[idx].question = card.question; newCards[idx].answer = card.answer; newCards[idx].category = card.category; }
    } else if (action === 'delete') {
       newCards = newCards.filter(c => c.id !== card.id);
    } else if (action === 'add') {
       newCards.push({ id: card.id, question: card.question, answer: card.answer, category: card.category, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 });
    }
    await firestore.collection("susuru_anki_shared").doc(docId).update({ cards: newCards });
  } catch(e) { console.error("Cloud update failed", e); }
}

async function shareCategory(catName) {
  if (!currentUser) return alert("管理画面からログインしてください。");
  const allTargets = getAllSubcategories(catName); const subset = db.filter(q => allTargets.includes(q.category));
  let partialTree = {}; allTargets.forEach(t => { if(categoryTree[t]) partialTree[t] = categoryTree[t]; });
  try {
    const docRef = await firestore.collection("susuru_anki_shared").add({ catName: catName, cards: subset, categories: allTargets, categoryTree: partialTree, ownerId: currentUser.uid, ownerName: currentUser.displayName || currentUser.email || '不明', friends: [], createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    
    // 自分が作ったものも同期対象にする
    if (!subscribedDocs.includes(docRef.id)) subscribedDocs.push(docRef.id);
    db.forEach(q => { if (subset.find(s => s.id === q.id)) q.sharedDocId = docRef.id; });
    saveData(); syncSubscriptions();
    
    const shareUrl = window.location.origin + window.location.pathname + "?share_id=" + docRef.id; await navigator.clipboard.writeText(shareUrl); alert(`✅ URLを発行・コピーしました！\nURL: ${shareUrl}\n\n（※今後、あなたがこのカテゴリー内の問題を編集・追加すると、全員に自動同期されます）`);
  } catch(err) { alert("⚠️ URLの発行に失敗しました。ルールの確認を。"); }
}

function listenToSharedDoc(docId) {
  if (unsubscribeShared) unsubscribeShared(); currentSharedDocId = docId; document.getElementById('sharedTitle').innerText = "⏳ 読み込み中...";
  unsubscribeShared = firestore.collection("susuru_anki_shared").doc(docId).onSnapshot((snap) => {
    if (!snap.exists) { alert("⚠️ 共有データが見つかりません。"); exitSharedMode(); return; }
    currentSharedData = snap.data(); renderSharedPage();
  }, err => alert("⚠️ 共有データの取得に失敗しました。"));
}

// ★ ドロップダウンに自分のフレンドを読み込む処理
async function loadFriendsForSharedPanel() {
  const select = document.getElementById('selFriendToAdd');
  if (!select) return;
  select.innerHTML = '<option value="">フレンドから選択...</option>';
  if (!currentUser) return;
  try {
    const snap = await firestore.collection('susuru_anki_profiles').doc(currentUser.uid).get();
    const friends = snap.exists ? (snap.data().friends || []) : [];
    for (const fUid of friends) {
      let fName = fUid;
      if (friendNameCache[fUid]) {
        fName = friendNameCache[fUid];
      } else {
        const fSnap = await firestore.collection('susuru_anki_profiles').doc(fUid).get();
        if (fSnap.exists) {
          fName = fSnap.data().displayName || fUid;
          friendNameCache[fUid] = fName; // キャッシュに保存
        }
      }
      const opt = document.createElement('option');
      opt.value = fUid;
      opt.innerText = fName;
      select.appendChild(opt);
    }
  } catch(e) { console.warn("フレンドリストの読み込みに失敗", e); }
}

function renderSharedPage() {
  if (!currentSharedData) return; 
  const data = currentSharedData;
  document.getElementById('sharedTitle').innerText = `🌐 ${escapeHtml(data.catName)}`; 
  document.getElementById('sharedOwnerName').innerText = escapeHtml(data.ownerName); 
  document.getElementById('sharedCardCount').innerText = data.cards.length;
  
  const isOwner = currentUser && currentUser.uid === data.ownerId; 
  const isFriend = currentUser && data.friends && data.friends.includes(currentUser.uid); 
  const canEdit = isOwner || isFriend;
  
  document.getElementById('sharedOwnerPanel').style.display = isOwner ? 'block' : 'none'; 
  document.getElementById('sharedEditorPanel').style.display = canEdit ? 'block' : 'none';
  
  const viewerPanel = document.getElementById('sharedViewerPanel');
  if (viewerPanel) viewerPanel.style.display = (!isOwner && !isFriend) ? 'block' : 'none';
  
  if (isOwner) {
    if (!sharedFriendsLoaded) {
      loadFriendsForSharedPanel();
      sharedFriendsLoaded = true;
    }
    
    const fList = document.getElementById('sharedFriendsList'); 
    fList.innerHTML = ''; 
    const friendsArray = data.friends || [];
    
    if (friendsArray.length === 0) {
      fList.innerHTML = '<span style="font-size:0.8rem; color:var(--text3);">許可されたフレンドはいません。</span>';
    } else {
      friendsArray.forEach(fUid => {
        let displayName = friendNameCache[fUid] || fUid;
        if (!friendNameCache[fUid]) {
          firestore.collection('susuru_anki_profiles').doc(fUid).get().then(snap => {
            if (snap.exists) {
              friendNameCache[fUid] = snap.data().displayName || fUid;
              const el = document.getElementById(`shared_friend_name_${fUid}`);
              if (el) el.innerText = friendNameCache[fUid];
            }
          });
        }
        
        fList.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg3); padding:8px; border-radius:6px; border:1px solid var(--border);">
          <span id="shared_friend_name_${fUid}" style="font-size:0.8rem;">${escapeHtml(displayName)}</span>
          <button class="btn btn-danger" style="padding:4px 10px; font-size:0.75rem;" onclick="removeFriendFromShared('${fUid}')">削除</button>
        </div>`;
      });
    }
  }
  
  const cList = document.getElementById('sharedCardsList'); cList.innerHTML = '';
  if (data.cards.length === 0) cList.innerHTML = '<div style="color:var(--text3); font-size:0.9rem; text-align:center;">カードがありません</div>';
  else data.cards.forEach((card, idx) => cList.innerHTML += `<div class="q-card"><div class="q-card-text">${escapeHtml(card.question)}</div><div style="font-size:0.85rem; color:var(--text2); margin-top:4px;">A: <span style="color:var(--text);">${escapeHtml(getPrimaryAnswer(card.answer))}</span></div><div style="font-size:0.75rem; color:var(--text3); margin-top:8px;">📂 ${escapeHtml(card.category)}</div>${canEdit ? `<button class="btn btn-secondary" style="margin-top:10px; font-size:0.8rem;" onclick="deleteCardFromShared(${idx})">🗑️ 削除</button>` : ''}</div>`);
}

async function addFriendToShared() {
  const selectVal = document.getElementById('selFriendToAdd').value;
  const txtVal = document.getElementById('txtNewFriendUid').value.trim();
  const uid = selectVal || txtVal;
  
  if (!uid) return alert("フレンドを選択するか、UIDを入力してください。");
  
  const newFriends = [...(currentSharedData.friends || [])]; 
  if (!newFriends.includes(uid)) newFriends.push(uid);
  
  try { 
    await firestore.collection("susuru_anki_shared").doc(currentSharedDocId).update({ friends: newFriends }); 
    document.getElementById('selFriendToAdd').value = '';
    document.getElementById('txtNewFriendUid').value = ''; 
  } catch(e) { alert("⚠️ 追加に失敗しました"); }
}

async function removeFriendFromShared(uid) {
  if (!confirm("権限を取り消しますか？")) return;
  const newFriends = (currentSharedData.friends || []).filter(u => u !== uid);
  try { await firestore.collection("susuru_anki_shared").doc(currentSharedDocId).update({ friends: newFriends }); } catch(e) {}
}
async function addCardToShared() {
  const q = document.getElementById('txtSharedNewQ').value.trim(), a = document.getElementById('txtSharedNewA').value.trim(); if (!q || !a) return;
  const newCard = { id: 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36), question: q, answer: a, category: currentSharedData.catName, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 };
  try { await firestore.collection("susuru_anki_shared").doc(currentSharedDocId).update({ cards: [...currentSharedData.cards, newCard] }); document.getElementById('txtSharedNewQ').value = ''; document.getElementById('txtSharedNewA').value = ''; } catch(e) {}
}
async function deleteCardFromShared(idx) {
  if (!confirm("クラウド上から削除しますか？")) return;
  const newCards = [...currentSharedData.cards]; newCards.splice(idx, 1);
  try { await firestore.collection("susuru_anki_shared").doc(currentSharedDocId).update({ cards: newCards }); } catch(e) {}
}

function importCurrentShared() {
  const data = currentSharedData; if (!data) return;
  if (!confirm(`購読しますか？\n（今後、作成者が問題を編集・追加すると自動で同期されます）`)) return;
  
  if (!subscribedDocs.includes(currentSharedDocId)) subscribedDocs.push(currentSharedDocId);
  (data.categories || []).forEach(c => { if(!categories.includes(c)) categories.push(c); });
  for (let p in (data.categoryTree || {})) { if (!categoryTree[p]) categoryTree[p] = []; (data.categoryTree[p] || []).forEach(c => { if (!categoryTree[p].includes(c)) categoryTree[p].push(c); }); }
  
  let count = 0;
  (data.cards || []).forEach(q => {
    if (!q.question || !q.answer) return;
    let existing = db.find(d => d.id === q.id);
    if (existing) {
      existing.sharedDocId = currentSharedDocId;
    } else {
      db.push({ id: q.id, question: q.question, answer: q.answer, category: q.category, sharedDocId: currentSharedDocId, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 }); count++;
    }
  });
  autoMerge(); alert(`✅ 取り込みました！\n新規追加: ${count}件`); exitSharedMode();
  syncSubscriptions();
}
function exitSharedMode() {
  if (unsubscribeShared) unsubscribeShared(); currentSharedDocId = null; currentSharedData = null;
  sharedFriendsLoaded = false;
  const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname; window.history.pushState({path: cleanUrl}, '', cleanUrl); openPage('pgHome');
}

async function makePublicCategory(catName) {
  if (!currentUser) return alert("ログインしてください");
  const allTargets = getAllSubcategories(catName); const subset = db.filter(q => allTargets.includes(q.category)); let partialTree = {}; allTargets.forEach(t => { if(categoryTree[t]) partialTree[t] = categoryTree[t]; });
  
  try {
    const docRef = await firestore.collection("susuru_anki_shared").add({
      catName: catName, cards: subset, categories: allTargets, categoryTree: partialTree, ownerId: currentUser.uid, ownerName: currentUser.displayName || currentUser.email || '不明', isPublic: true, friends: [], createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    if (!subscribedDocs.includes(docRef.id)) subscribedDocs.push(docRef.id);
    db.forEach(q => { if (subset.find(s => s.id === q.id)) q.sharedDocId = docRef.id; });
    saveData(); syncSubscriptions();
    
    alert(`✅ 「${catName}」を公開カテゴリーに設定しました！\n（※今後、あなたがこのカテゴリーを編集すると全員に同期されます）`);
  } catch(err) { alert("⚠️ 公開設定に失敗しました。ルールの確認を。"); }
}

async function deletePublicCategory(docId, catName) {
  if (!currentUser) return alert("ログインしてください");
  if (!confirm(`公開カテゴリーの一覧から「${escapeHtml(catName)}」を削除（公開停止）しますか？\n\n※手元にある元のフォルダーや問題データは消えずにそのまま残ります。`)) return;
  try {
    const docSnap = await firestore.collection("susuru_anki_shared").doc(docId).get();
    if (!docSnap.exists) return alert("カテゴリーが見つかりません");
    const data = docSnap.data(); if (data.ownerId !== currentUser.uid) return alert("削除権限がありません");
    await firestore.collection("susuru_anki_shared").doc(docId).delete();
    subscribedDocs = subscribedDocs.filter(id => id !== docId); saveData();
    alert("✅ 公開を停止しました（手元のデータは安全です）"); loadPublicCategories();
  } catch(e) { alert("⚠️ 削除に失敗しました"); }
}

let publicCategoriesCache = []; let unsubscribePublicCategories = null;

async function loadPublicCategories() {
  const listDiv = document.getElementById('publicCategoriesList'); listDiv.innerHTML = '<div style="text-align:center; color:var(--text2);">読み込み中...</div>';
  try {
    if (unsubscribePublicCategories) unsubscribePublicCategories();
    unsubscribePublicCategories = firestore.collection("susuru_anki_shared").where('isPublic', '==', true).onSnapshot(snap => {
        publicCategoriesCache = []; snap.forEach(doc => { publicCategoriesCache.push({ id: doc.id, ...doc.data() }); }); renderPublicCategories();
      });
  } catch(e) { listDiv.innerHTML = '<div style="color:var(--danger);">公開カテゴリーの読み込みに失敗しました</div>'; }
}

function renderPublicCategories() {
  const listDiv = document.getElementById('publicCategoriesList'); const searchText = document.getElementById('searchPublicCategories').value.toLowerCase();
  const filtered = publicCategoriesCache.filter(cat => cat.catName.toLowerCase().includes(searchText) || (cat.ownerName || '').toLowerCase().includes(searchText));
  if (filtered.length === 0) { listDiv.innerHTML = '<div style="text-align:center; color:var(--text3); margin-top:40px;">公開カテゴリーがありません</div>'; return; }
  listDiv.innerHTML = '';
  filtered.forEach(cat => {
    const card = document.createElement('div'); card.className = 'card'; card.style.cursor = 'pointer'; card.style.position = 'relative';
    const isOwner = currentUser && cat.ownerId === currentUser.uid;
    
    // ★ 今回の修正：全員が見れる「🌐 詳細・管理」ボタンを追加しました！
    card.innerHTML = `
      <div class="q-card-text">${escapeHtml(cat.catName)}</div>
      <div style="font-size:0.85rem; color:var(--text2); margin-top:4px;">作成者: <span style="color:var(--text);">${escapeHtml(cat.ownerName || 'Unknown')}</span></div>
      <div style="font-size:0.8rem; color:var(--text3); margin-top:6px;">カード数: <span style="color:var(--primary); font-weight:bold;">${(cat.cards || []).length}問</span></div>
      <button class="btn btn-secondary" style="margin-top:10px; width:100%;" onclick="openPage('pgShared'); listenToSharedDoc('${cat.id}')">🌐 詳細・共同編集者の管理</button>
      <button class="btn btn-success" style="margin-top:8px; width:100%;" onclick="importPublicCategory('${cat.id}', '${escapeHtml(cat.catName)}')">📥 購読してインポート</button>
      ${isOwner ? `<button class="btn btn-danger" style="margin-top:8px; width:100%;" onclick="deletePublicCategory('${cat.id}', '${escapeHtml(cat.catName)}')">🗑️ 削除</button>` : ''}`;
    listDiv.appendChild(card);
  });
}

function filterPublicCategories() { renderPublicCategories(); }

async function importPublicCategory(docId, catName) {
  const cat = publicCategoriesCache.find(c => c.id === docId); if (!cat) return alert('カテゴリーが見つかりません');
  if (!confirm(`「${escapeHtml(catName)}」を購読しますか？\n（今後、作成者が問題を編集・追加すると自動で同期されます）`)) return;
  try {
    if (!subscribedDocs.includes(docId)) subscribedDocs.push(docId);
    (cat.categories || []).forEach(c => { if (!categories.includes(c)) categories.push(c); });
    for (let p in (cat.categoryTree || {})) { if (!categoryTree[p]) categoryTree[p] = []; (cat.categoryTree[p] || []).forEach(c => { if (!categoryTree[p].includes(c)) categoryTree[p].push(c); }); }
    let count = 0;
    (cat.cards || []).forEach(q => {
      if (!q.question || !q.answer) return;
      let existing = db.find(d => d.id === q.id);
      if (existing) { existing.sharedDocId = docId; } 
      else { db.push({ id: q.id, question: q.question, answer: q.answer, category: q.category, sharedDocId: docId, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 }); count++; }
    });
    autoMerge(); alert(`✅ 購読完了！\n新規追加: ${count}件`); openPage('pgBox');
    syncSubscriptions();
  } catch(e) { alert('⚠️ 購読に失敗しました'); }
}