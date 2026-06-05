// ----------------- コンテキストメニュー & 長押し -----------------
function setupLongpress(element, actionCallback) {
  let pressTimer = null; 
  let startX = 0, startY = 0;
  let isDragging = false;
  
  const startHandler = (e) => {
    if (e.type === 'contextmenu') { e.preventDefault(); return; }
    if (e.touches && e.touches.length > 1) return;
    
    let clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let clientY = e.touches ? e.touches[0].clientY : e.clientY;
    startX = clientX; startY = clientY;
    isDragging = false;
    
    pressTimer = setTimeout(() => {
      if (!isDragging) { 
        if (navigator.vibrate) navigator.vibrate(50); 
        actionCallback(); 
      }
    }, 500);
  };
  
  const moveHandler = (e) => { 
    if(!pressTimer) return;
    let clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let clientY = e.touches ? e.touches[0].clientY : e.clientY;
    if(Math.abs(clientX - startX) > 10 || Math.abs(clientY - startY) > 10) {
      isDragging = true; 
      clearTimeout(pressTimer); 
      pressTimer = null;
    }
  };
  
  const cancelHandler = () => { 
    if(pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  };
  
  element.addEventListener('mousedown', startHandler); 
  element.addEventListener('touchstart', startHandler, { passive: true });
  element.addEventListener('mousemove', moveHandler); 
  element.addEventListener('touchmove', moveHandler, { passive: true });
  element.addEventListener('mouseup', cancelHandler); 
  element.addEventListener('mouseleave', cancelHandler);
  element.addEventListener('touchend', cancelHandler); 
  element.addEventListener('touchcancel', cancelHandler);
  element.addEventListener('contextmenu', e => { e.preventDefault(); });
}

function openContextMenu(title, items) {
  document.getElementById('ctxHeader').innerText = title;
  const body = document.getElementById('ctxBody'); body.innerHTML = '';
  items.forEach(item => {
    if (item.type === 'separator') {
      const sep = document.createElement('div'); sep.className = 'menu-sep'; body.appendChild(sep);
    } else {
      const btn = document.createElement('button'); btn.className = `menu-item ${item.danger ? 'danger' : ''}`;
      btn.innerHTML = item.html; btn.onclick = () => { closeContextMenu(); item.action(); }; body.appendChild(btn);
    }
  });
  document.getElementById('ctxOverlay').style.display = 'flex';
}
function closeContextMenu() { document.getElementById('ctxOverlay').style.display = 'none'; }

function handleCategoryLongpress(catName) {
  if (catName === "未分類") return alert("基本フォルダーは変更できません。");
  
  let isSharedReadOnly = false;
  let isSubscribedOther = false; // 他人が作った購読カテゴリー
  const sharedCard = db.find(q => q.category === catName && q.sharedDocId);
  if (sharedCard) {
    const docId = sharedCard.sharedDocId;
    const perm = sharedDocPermissions[docId];
    if (!perm || !perm.canEdit) isSharedReadOnly = true;
    // ownedDocs（確実なローカル記録）を最優先で参照し、なければpermのisOwnerで判断
    const isDocOwner = ownedDocs.includes(docId) || (perm && perm.isOwner);
    if (!isDocOwner && subscribedDocs.includes(docId)) isSubscribedOther = true;
  }

  const subCats = getAllSubcategories(catName);
  const validParents = categories.filter(c => c !== catName && !subCats.includes(c));
  let moveOptions = validParents.map(p => ({
    html: `📁 「${p}」の中へ移動`,
    action: () => {
      if (isSharedReadOnly) return alert("🔒 閲覧専用の共有カテゴリーは構造の移動ができません。");
      for(let g in categoryTree) { if(categoryTree[g]) categoryTree[g] = categoryTree[g].filter(c => c !== catName); }
      if(!categoryTree[p]) categoryTree[p] = []; categoryTree[p].push(catName);
      saveData(true); renderTree();
      // ★【0.02.59-g】移動先・移動元どちらかがshared対象なら構造同期
      const _mvDocId = findEditableSharedDocForCat(p) || findEditableSharedDocForCat(catName);
      if (_mvDocId) syncSharedDocStructure(_mvDocId);
    }
  }));

  openContextMenu(`フォルダー: ${catName}`, [
    { html: '🔗 このフォルダーの共有URLを発行', action: () => { shareCategory(catName); } },
    { html: '🌐 公開カテゴリーに設定', action: () => { makePublicCategory(catName); } },
    { type: 'separator' },
    { html: '➕ 中にサブフォルダーを作る', action: () => {
        if (isSharedReadOnly) return alert("🔒 閲覧専用の共有カテゴリー内にフォルダーは作成できません。");
        const n = prompt(`「${catName}」の中に作成するフォルダー名:`);
        if(!n || n.trim() === "") return; if(categories.includes(n.trim())) return alert("既に存在します。");
        categories.push(n.trim()); if(!categoryTree[catName]) categoryTree[catName] = [];
        categoryTree[catName].push(n.trim()); 
        deletedCats = deletedCats.filter(c => c !== n.trim());
        saveData(true); renderTree();
        // ★【0.02.59-g】公開カテゴリーに同期
        syncNewCategoryToShared(catName, n.trim());
      } },
    { html: '📝 この直下に問題を追加', action: () => { currentViewContext = { type: 'category', value: catName }; showAddQModal(); } },
    { type: 'separator' },
    { html: '✏️ フォルダー名を変更', action: () => {
        if (isSharedReadOnly) return alert("🔒 閲覧専用の共有カテゴリー名は変更できません。");
        const n = prompt("新しいフォルダー名を入力:", catName);
        if(!n || n.trim() === "" || n === catName) return; if(categories.includes(n.trim())) return alert("既に同名が存在します。");
        categories = categories.map(c => c === catName ? n.trim() : c);
        for(let p in categoryTree) { categoryTree[p] = categoryTree[p].map(c => c === catName ? n.trim() : c); }
        if(categoryTree[catName]) { categoryTree[n.trim()] = categoryTree[catName]; delete categoryTree[catName]; }
        db.forEach(q => { if(q.category === catName) q.category = n.trim(); });
        deletedCats = deletedCats.filter(c => c !== n.trim());
        saveData(true); renderTree();
      } },
    { html: '➕ 問題を一括追加 (Q,A 改行)', action: () => { showBulkAddModal(catName); } },
    { type: 'separator' }, ...moveOptions, { type: 'separator' },
    { html: '🔄 成績をリセット (このフォルダーのみ)', action: () => {
        if(!confirm(`⚠️ 「${catName}」とサブフォルダー内の全てのカードの成績（正解数・レベル等）をリセットしますか？\n（問題自体は消えません）`)) return;
        const targetCats = getAllSubcategories(catName);
        let resetCount = 0;
        db.forEach(q => {
          if(targetCats.includes(q.category)) {
            q.level = 0; q.correct = 0; q.incorrect = 0; q.streak = 0; q.wrongStreak = 0; q.shikkariStreak = 0;
            resetCount++;
          }
        });
        saveData(true);
        alert(`✅ ${resetCount}件の成績をリセットしました！`);
        if (document.getElementById('pgStats') && document.getElementById('pgStats').classList.contains('active')) renderStatsAndCharts();
      } },
    ...(isSubscribedOther ? [
      { html: '🚫 購読を解除', danger: true, action: () => { unsubscribeSharedCategory(catName); } }
    ] : [
      { html: '❌ 削除 (中身も全て削除)', danger: true, action: () => {
          if (isSharedReadOnly) return alert("🔒 閲覧専用の共有カテゴリーはローカルから直接削除できません。（※不要になった場合はアプリをリセットするか個別に消去してください）");
          if(!confirm(`警告: 「${catName}」と中身を全て削除しますか？`)) return;
          const toDelete = getAllSubcategories(catName);
          // ★【0.02.59-g】公開カテゴリーからのみ削除（ローカルの削除は後で行う）
          removeCategoryFromShared(catName);
          deletedCats.push(...toDelete);
          db.forEach(q => { if(toDelete.includes(q.category)) deletedCards.push(q.id); });
          db = db.filter(q => !toDelete.includes(q.category)); categories = categories.filter(c => !toDelete.includes(c));
          for(let p in categoryTree) { if(toDelete.includes(p)) delete categoryTree[p]; else if(categoryTree[p]) categoryTree[p] = categoryTree[p].filter(c => !toDelete.includes(c)); }
          saveData(true); renderTree();
        } }
    ])
  ]);
}
