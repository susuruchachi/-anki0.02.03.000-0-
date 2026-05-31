// ----------------- 問題箱機能 -----------------
let _boxAnswerCache = {};
function showAllCards() { currentViewContext = 'all'; const sb = document.getElementById('txtSearchBox'); if(sb) sb.value = ''; renderBox(); }
function filterBoxByStatus(statusType) { currentViewContext = statusType; openPage('pgBox'); }

function renderBox() {
  const container = document.getElementById('boxList'); container.innerHTML = '';
  let filtered = [...db]; let titleString = "📝 全ての問題一覧";
  const th = parseInt(document.getElementById('numGradThreshold').value) || 5;

  let navContainer = null;
  const specialViews = ['all', 'grad', 'master', 'normal', 'weak', 'shikkari', 'unseen'];
  
  if (typeof currentViewContext === 'object' && currentViewContext.type === 'category') {
    const currentCat = currentViewContext.value;
    const subCats = getAllSubcategories(currentCat); 
    filtered = db.filter(q => subCats.includes(q.category));
    titleString = `🔖 ${currentCat}`;
    
    // ★ 下位カテゴリー・上位階層への移動ボタンを生成
    let parentCat = null;
    if (typeof categoryTree !== 'undefined') {
      for (let p in categoryTree) { 
        if (categoryTree[p] && categoryTree[p].includes(currentCat)) { parentCat = p; break; } 
      }
    }
    
    navContainer = document.createElement('div');
    navContainer.style.cssText = 'display:flex; gap:8px; overflow-x:auto; padding-bottom:10px; margin-bottom:10px; border-bottom:1px solid var(--border);';
    
    if (parentCat) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary';
      btn.style.cssText = 'padding:6px 12px; font-size:0.8rem; white-space:nowrap; border-radius:20px; width:auto; background:var(--bg3);';
      btn.innerText = `⬆️ 上の階層 (${parentCat})`;
      btn.onclick = (e) => { 
        e.preventDefault();
        currentViewContext = { type: 'category', value: parentCat }; 
        renderBox(); 
      };
      navContainer.appendChild(btn);
    }
    
    if (typeof categoryTree !== 'undefined' && categoryTree[currentCat]) {
      const children = categoryTree[currentCat] || [];
      children.forEach(c => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary';
        btn.style.cssText = 'padding:6px 12px; font-size:0.8rem; white-space:nowrap; border-radius:20px; width:auto;';
        btn.innerText = `📂 ${c}`;
        btn.onclick = (e) => { 
          e.preventDefault();
          currentViewContext = { type: 'category', value: c }; 
          renderBox(); 
        };
        navContainer.appendChild(btn);
      });
    }
    
    if (navContainer.childNodes.length === 0) navContainer = null;
    
  } else if (typeof currentViewContext === 'string' && currentViewContext !== 'all') {
    titleString = `📊 実績抽出カードの一覧`;
    if (currentViewContext === 'grad') filtered = db.filter(q => q.correct >= th);
    if (currentViewContext === 'master') filtered = db.filter(q => q.correct < th && q.level >= 3);
    if (currentViewContext === 'normal') filtered = db.filter(q => q.correct < th && q.level >= 1 && q.level <= 2);
    if (currentViewContext === 'weak') filtered = db.filter(q => q.correct < th && q.level === 0 && (q.correct+q.incorrect)>0);
    if (currentViewContext === 'shikkari') filtered = db.filter(q => q.correct < th && q.level === -1);
    if (currentViewContext === 'unseen') filtered = db.filter(q => q.correct === 0 && q.incorrect === 0 && q.level >= 0);
  }

  const sb = document.getElementById('txtSearchBox');
  if (sb && sb.value.trim() !== '') {
    const kw = sb.value.trim().toLowerCase();
    filtered = filtered.filter(q => q.question.toLowerCase().includes(kw) || q.answer.toLowerCase().includes(kw));
  }

  document.getElementById('boxTitle').innerText = titleString;
  document.getElementById('lblBoxCount').innerText = `${filtered.length} 件`;
  
  if (navContainer) container.appendChild(navContainer);

  if(filtered.length === 0) { 
    const emptyMsg = document.createElement('div');
    emptyMsg.style.cssText = 'text-align:center; padding:40px; color:var(--text3);';
    emptyMsg.innerText = '問題がありません';
    container.appendChild(emptyMsg);
    return; 
  }

  filtered.forEach(item => {
    const isGrad = item.correct >= th;
    const card = document.createElement('div'); card.className = 'q-card';
    setupLongpress(card, () => handleQuestionLongpress(item));
    _boxAnswerCache[item.id] = item.answer;

    const lvlStr = item.level === -1 ? 'しっかり' : 'LV '+item.level;
    const badgeHTML = `<span class="badge ${isGrad ? 'badge-grad':'badge-level'}">${isGrad ? 'GRADUATE' : lvlStr}</span>`;
    
    // 共有カードアイコンの追加
    const sharedIcon = item.sharedDocId ? `<span style="margin-left:6px; font-size:0.75rem; color:var(--accent);">🌐同期</span>` : '';
    
    card.innerHTML = `
      <div class="q-card-text">${escapeHtml(item.question)}</div>
      <div style="font-size:0.85rem; color:var(--text2); margin-bottom:8px; cursor:pointer;" data-id="${escapeHtml(item.id)}" data-shown="0" onclick="toggleCardAnswer(this)">
        A: <span style="background:var(--bg4); color:var(--text2); padding:2px 8px; border-radius:6px; border:1px solid var(--border); display:inline-block; font-size:0.75rem;">👆 タップして答えを表示</span>
      </div>
      <div class="q-card-sub">${badgeHTML}<span>正: ${item.correct} / 誤: ${item.incorrect}</span><span style="font-size:0.75rem; color:var(--text3);">📂 ${escapeHtml(item.category)}${sharedIcon}</span></div>
    `;
    container.appendChild(card);
  });
}

function toggleCardAnswer(el) {
  const itemId = el.getAttribute('data-id'); const ans = _boxAnswerCache[itemId] || '';
  const shown = el.getAttribute('data-shown') === '1';
  el.setAttribute('data-shown', shown ? '0' : '1');
  if (shown) { el.innerHTML = 'A: <span style="background:var(--bg4); color:var(--text2); padding:2px 8px; border-radius:6px; border:1px solid var(--border); display:inline-block; font-size:0.75rem;">👆 タップして答えを表示</span>'; } 
  else { el.innerHTML = 'A: <span style="color:var(--text); font-weight:500;">' + escapeHtml(ans) + '</span><span style="color:var(--text3); font-size:0.7rem; margin-left:8px;">👆 隠す</span>'; }
}

function handleQuestionLongpress(item) {
  // ★ 権限チェック (共同開発者以外はローカルでも一切の編集・削除・移動を禁止)
  if (item.sharedDocId) {
    const perm = sharedDocPermissions[item.sharedDocId];
    if (!perm || !perm.canEdit) {
      return alert("🔒 【閲覧専用】\nこのカードは購読している共有カテゴリーのため、作成者または許可された共同編集者のみ編集・削除できます。\n(あなたの学習記録はあなた専用に保存されています)");
    }
  }

  const sortedCategories = getSortedCategoriesForMenu();
  let moveOptions = [];
  sortedCategories.forEach(cat => {
    if (cat !== item.category) { moveOptions.push({ html: `📂 フォルダー「${cat}」へ移動`, action: async () => { 
      item.category = cat; 
      if (item.sharedDocId) await updateCardInSharedDoc(item.sharedDocId, item, 'edit');
      saveData(); renderBox(); 
    } }); }
  });
  
  openContextMenu("カード操作", [
    { html: '✏️ 編集', action: async () => {
        const newQ = prompt("問題文を編集:", item.question); if(newQ === null) return;
        const newA = prompt("答えを編集:", item.answer); if(newA === null) return;
        item.question = newQ.trim() || item.question; item.answer = newA.trim() || item.answer;
        if (item.sharedDocId) await updateCardInSharedDoc(item.sharedDocId, item, 'edit');
        autoMerge(); renderBox();
      } },
    { type: 'separator' }, ...moveOptions, { type: 'separator' },
    { html: '🗑️ 削除', danger: true, action: async () => { 
        if(!confirm("完全に消去しますか？")) return; 
        db = db.filter(q => q.id !== item.id); 
        if (item.sharedDocId) await updateCardInSharedDoc(item.sharedDocId, item, 'delete');
        saveData(); renderBox(); 
      } }
  ]);
}

function showAddQModal() {
  let defaultCat = "未分類";
  const specialViews = ['all', 'grad', 'master', 'normal', 'weak', 'shikkari', 'unseen'];
  
  if (typeof currentViewContext === 'object' && currentViewContext.type === 'category') {
    defaultCat = currentViewContext.value;
  }
  
  // ★ 追加先が共有カテゴリーの場合、権限をチェック
  let targetSharedDocId = null;
  const existingCard = db.find(q => q.category === defaultCat && q.sharedDocId);
  if (existingCard) {
    targetSharedDocId = existingCard.sharedDocId;
    const perm = sharedDocPermissions[targetSharedDocId];
    if (!perm || !perm.canEdit) return alert("🔒 【閲覧専用】\nこの共有カテゴリーは閲覧専用のため、新しい問題を追加できません。");
  }

  const q = prompt("新規追加：問題文"); if(!q || q.trim() === "") return;
  const a = prompt("新規追加：正解"); if(!a || a.trim() === "") return;
  const newCard = { id: 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36), question: q.trim(), answer: a.trim(), category: defaultCat, level: 0, correct: 0, incorrect: 0, streak: 0, wrongStreak: 0, shikkariStreak: 0 };
  
  if (targetSharedDocId) newCard.sharedDocId = targetSharedDocId;
  db.push(newCard);
  
  if (targetSharedDocId) updateCardInSharedDoc(targetSharedDocId, newCard, 'add');
  autoMerge(); renderBox();
}
