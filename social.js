// ====== ソーシャル機能（フレンド・ランキング・オンライン対戦） ======

// ★ オンライン対戦用グローバル変数
window.currentOnlineMatch = null;
window.matchScoreListener = null;

// ★ 画面を止まらせないための通知UI（Toast）
function showMatchToast(msg, duration = 0) {
  let toast = document.getElementById('matchToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'matchToast';
    toast.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background:rgba(0,0,0,0.85); color:#fff; padding:25px 40px; border-radius:15px; font-size:1.2rem; font-weight:bold; z-index:9999; text-align:center; box-shadow:0 10px 30px rgba(0,0,0,0.5); pointer-events:none; transition: opacity 0.3s;';
    document.body.appendChild(toast);
  }
  toast.innerHTML = msg;
  toast.style.display = 'block';
  toast.style.opacity = '1';

  if (window.matchToastTimeout) clearTimeout(window.matchToastTimeout);
  if (duration > 0) {
    window.matchToastTimeout = setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.style.display = 'none', 300);
    }, duration);
  }
}

function hideMatchToast() {
  const toast = document.getElementById('matchToast');
  if (toast) {
    toast.style.opacity = '0';
    setTimeout(() => toast.style.display = 'none', 300);
  }
}

// ★ リロードやタブ閉じ時の切断検知を強化（beforeunload + pagehide）
function handleBrowserUnload() {
  if (window.currentOnlineMatch && window.currentOnlineMatch.roomId) {
    firestore.collection('susuru_anki_match_rooms').doc(window.currentOnlineMatch.roomId).update({
      status: 'abandoned'
    }).catch(()=>{});
  }
}
window.addEventListener('beforeunload', handleBrowserUnload);
window.addEventListener('pagehide', handleBrowserUnload);

// ★ SPA等、別ページ遷移時の切断検知 (すするanki内のタブ移動対策)
if (typeof window.openPage === 'function' && !window.isOpenPageHookedForMatch) {
  const originalOpenPage = window.openPage;
  window.openPage = function(pageId) {
    // 対戦中にクイズ画面や結果画面以外へ移動しようとした場合、切断(放棄)扱いにする
    if (window.currentOnlineMatch && window.currentOnlineMatch.roomId && pageId !== 'pgQuizPlayer' && pageId !== 'pgStats') {
        firestore.collection('susuru_anki_match_rooms').doc(window.currentOnlineMatch.roomId).update({
          status: 'abandoned'
        }).catch(()=>{});
        
        if (!window.currentOnlineMatch.resultsShown) {
            window.currentOnlineMatch.resultsShown = true;
            hideMatchToast();
            alert("⚠️ 対戦中に別のページへ移動したため、試合を放棄しました。");
        }
        
        // クリーンアップ
        if (window.matchScoreListener) { window.matchScoreListener(); window.matchScoreListener = null; }
        const vsBar = document.getElementById('matchVsBar');
        if (vsBar) vsBar.remove();
        window.currentOnlineMatch = null;
    }
    return originalOpenPage.apply(this, arguments);
  };
  window.isOpenPageHookedForMatch = true;
}

function initOnlineMatchPage() {
  const scopeContainer = document.getElementById('onlineMatchScopeSelectors');
  if (!scopeContainer) return;
  scopeContainer.innerHTML = '';
  selectedScopePath = [];
  createOnlineMatchScopeSelect(0, getTopLevelCategories());
}

function createOnlineMatchScopeSelect(depth, categoriesToShow) {
  if (categoriesToShow.length === 0) return;
  const container = document.getElementById('onlineMatchScopeSelectors');
  if (!container) return;
  
  const select = document.createElement('select');
  select.className = 'form-control';
  select.style.marginBottom = '10px';
  
  if (depth === 0) {
    const optAll = document.createElement('option');
    optAll.value = "all";
    optAll.innerText = "🌐 全てから出題";
    select.appendChild(optAll);
  }
  
  const optDefault = document.createElement('option');
  optDefault.value = "";
  optDefault.innerText = depth === 0 ? "📁 トップカテゴリー..." : "📂 サブカテゴリー...";
  optDefault.disabled = true;
  optDefault.selected = true;
  select.appendChild(optDefault);
  
  categoriesToShow.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.innerText = depth === 0 ? `📁 ${cat}` : `📂 ${cat}`;
    select.appendChild(opt);
  });
  
  select.onchange = (e) => {
    const val = e.target.value;
    const selects = Array.from(container.querySelectorAll('select'));
    selects.forEach((sel, idx) => { if (idx > depth) sel.remove(); });
    
    if (val === "all") {
      selectedScopePath = ["all"];
      return;
    }
    
    selectedScopePath[depth] = val;
    selectedScopePath = selectedScopePath.slice(0, depth + 1);
    const children = categoryTree[val] || [];
    if (children.length > 0) {
      createOnlineMatchScopeSelect(depth + 1, children);
    }
  };
  
  container.appendChild(select);
}

// 🎲 ランダムマッチ機能
function startOnlineMatching() {
  if (!currentUser) return alert("オンライン対戦にはログインが必要です。");
  
  const qCountInput = document.getElementById('onlineMatchQuestionCount');
  const timeLimitInput = document.getElementById('onlineMatchTimeLimit');
  const qCount = parseInt(qCountInput?.value) || 10;
  const timeLimit = parseInt(timeLimitInput?.value) || 15;
  
  const targetCat = selectedScopePath.length > 0 && selectedScopePath[0] !== "all" 
    ? selectedScopePath[selectedScopePath.length - 1] 
    : "all";
  
  showMatchToast("🔍 ランダムマッチを探しています...<br><span style='font-size:0.9rem;'>(同じカテゴリーの人を検索中)</span>");

  firestore.collection('susuru_anki_match_rooms')
    .where('status', '==', 'waiting')
    .get()
    .then(snap => {
      let targetRoom = null;
      let myExistingRoom = null;
      const now = Date.now();

      snap.forEach(doc => {
        const data = doc.data();
        if (now - data.createdAt > 300000) return; // 5分以上前の古い部屋（ゴースト）は無視

        if (data.category === targetCat && !data.isInviteOnly && !data.player2) {
          if (data.player1.uid === currentUser.uid) {
            myExistingRoom = doc;
          } else {
            targetRoom = doc;
          }
        }
      });

      if (myExistingRoom) {
        showMatchToast("⏳ 待機中です...<br>同じカテゴリーの相手を待っています。<br><span style='font-size:0.9rem;'>(30秒でタイムアウト)</span>");
        listenToWaitingRoom(myExistingRoom.id);
        return;
      }

      if (!targetRoom) {
        const newRoom = {
          id: 'match_rand_' + Math.random().toString(36).slice(2) + Date.now().toString(36),
          status: 'waiting',
          player1: { uid: currentUser.uid, name: currentUser.displayName || '名無し', score: 0, finished: false },
          player2: null,
          category: targetCat,
          questionCount: qCount,
          timeLimit: timeLimit,
          createdAt: new Date().getTime(),
          startedAt: null,
          isInviteOnly: false
        };
        
        firestore.collection('susuru_anki_match_rooms').doc(newRoom.id).set(newRoom)
          .then(() => {
            showMatchToast("⏳ 待機中です...<br>同じカテゴリーの相手を待っています。<br><span style='font-size:0.9rem;'>(30秒でタイムアウト)</span>");
            listenToWaitingRoom(newRoom.id, 30000);
          })
          .catch(e => { hideMatchToast(); alert("⚠️ ルーム作成エラー: " + e.message); });
      } else {
        const joinedData = targetRoom.data();
        joinedData.player2 = { uid: currentUser.uid, name: currentUser.displayName || '名無し', score: 0, finished: false };
        joinedData.status = 'ready';
        
        firestore.collection('susuru_anki_match_rooms').doc(targetRoom.id).update({
          player2: joinedData.player2,
          status: 'ready'
        })
        .then(() => {
          hideMatchToast();
          beginActiveMatch(targetRoom.id, 'player2', joinedData);
        })
        .catch(e => { hideMatchToast(); alert("⚠️ マッチング参加エラー: " + e.message); });
      }
    })
    .catch(e => { hideMatchToast(); alert("⚠️ ルーム検索エラー: " + e.message); });
}

// 🔑 合言葉で友達と対戦する機能（再利用・重複・ゴースト・自己マッチ対応版）
function createQuickMatch() {
  if (!currentUser) return alert("合言葉対戦にはログインが必要です。");
  
  const qCountInput = document.getElementById('onlineMatchQuestionCount');
  const timeLimitInput = document.getElementById('onlineMatchTimeLimit');
  const qCount = parseInt(qCountInput?.value) || 10;
  const timeLimit = parseInt(timeLimitInput?.value) || 15;
  
  const targetCat = selectedScopePath.length > 0 && selectedScopePath[0] !== "all" 
    ? selectedScopePath[selectedScopePath.length - 1] 
    : "all";
  
  const secretCode = prompt("【合言葉で対戦】\n友達と決めた「合言葉（数字や文字など）」を入力してください。\n\n※お互いに同じ合言葉を入力するとマッチングします。", "1234");
  
  if (!secretCode || secretCode.trim() === "") return;
  
  showMatchToast("🔍 部屋を探しています...");

  firestore.collection('susuru_anki_match_rooms')
    .where('status', '==', 'waiting')
    .get()
    .then(snap => {
      let targetRoom = null;
      let myExistingRoom = null;
      const now = Date.now();

      snap.forEach(doc => {
        const data = doc.data();
        if (now - data.createdAt > 300000) return; // 5分以上前の古い部屋（ゴースト）は無視

        if (data.isInviteOnly && data.secretCode === secretCode.trim()) {
          if (data.player1.uid === currentUser.uid) {
            myExistingRoom = doc;
          } else if (!data.player2) {
            targetRoom = doc;
          }
        }
      });

      if (myExistingRoom) {
        showMatchToast(`⏳ 待機中です...<br>友達に合言葉「 <span style='color:var(--accent);'>${escapeHtml(secretCode.trim())}</span> 」を入力してもらってください。`);
        listenToWaitingRoom(myExistingRoom.id);
        return;
      }

      if (targetRoom) {
        // 友達が作った部屋に合流する
        const joinedData = targetRoom.data();
        joinedData.player2 = { uid: currentUser.uid, name: currentUser.displayName || '名無し', score: 0, finished: false };
        joinedData.status = 'ready';

        firestore.collection('susuru_anki_match_rooms').doc(targetRoom.id).update({
          player2: joinedData.player2,
          status: 'ready'
        }).then(() => {
          hideMatchToast();
          beginActiveMatch(targetRoom.id, 'player2', joinedData);
        }).catch(e => { hideMatchToast(); alert("⚠️ 参加エラー: " + e.message); });
        
      } else {
        // 部屋が存在しない場合は完全ランダムなIDで新規作成して友達を待つ
        const newRoomId = 'match_secret_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        const matchRoom = {
          id: newRoomId,
          status: 'waiting',
          player1: { uid: currentUser.uid, name: currentUser.displayName || '名無し', score: 0, finished: false },
          player2: null,
          category: targetCat,
          questionCount: qCount,
          timeLimit: timeLimit,
          createdAt: new Date().getTime(),
          startedAt: null,
          isInviteOnly: true,
          secretCode: secretCode.trim()
        };
        
        firestore.collection('susuru_anki_match_rooms').doc(newRoomId).set(matchRoom)
          .then(() => {
            showMatchToast(`⏳ 待機中です...<br>友達に合言葉「 <span style='color:var(--accent);'>${escapeHtml(secretCode.trim())}</span> 」を入力してもらってください。`);
            listenToWaitingRoom(newRoomId);
          })
          .catch(e => { hideMatchToast(); alert("⚠️ ルーム作成エラー: " + e.message); });
      }
    }).catch(e => { hideMatchToast(); alert("⚠️ 通信エラー: " + e.message); });
}

// 待機中の部屋を監視する共通関数
function listenToWaitingRoom(roomId, timeoutMs = null) {
  let unsub = firestore.collection('susuru_anki_match_rooms').doc(roomId).onSnapshot(docSnap => {
    if (docSnap.exists) {
      const roomData = docSnap.data();
      if (roomData.status === 'ready' && roomData.player2) {
        unsub(); 
        hideMatchToast();
        beginActiveMatch(roomId, 'player1', roomData);
      }
    }
  });

  if (timeoutMs) {
    setTimeout(() => {
      unsub();
      firestore.collection('susuru_anki_match_rooms').doc(roomId).get()
        .then(docSnap => {
          if (docSnap.exists && docSnap.data().status === 'waiting') {
            firestore.collection('susuru_anki_match_rooms').doc(roomId).delete();
            hideMatchToast();
            alert("⏱️ タイムアウト。対戦相手が見つかりませんでした。");
          }
        });
    }, timeoutMs);
  }
}

// 招待URLを踏んだ時の処理
async function checkOnlineMatchInvite(roomId) {
  if (!currentUser) return alert("対戦に参加するにはログインが必要です。");
  
  try {
    const snap = await firestore.collection('susuru_anki_match_rooms').doc(roomId).get();
    if (!snap.exists) return alert("この対戦ルームは見つかりません。");
    
    const room = snap.data();
    if (room.status !== 'waiting') return alert("この対戦は既に開始されているか終了しています。");
    if (room.player1.uid === currentUser.uid) return alert("自分自身と対戦することはできません。");
    
    room.player2 = { uid: currentUser.uid, name: currentUser.displayName || '名無し', score: 0, finished: false };
    room.status = 'ready';
    
    await firestore.collection('susuru_anki_match_rooms').doc(roomId).update({
      player2: room.player2,
      status: 'ready'
    });
    
    beginActiveMatch(roomId, 'player2', room);
  } catch (e) {
    alert("⚠️ 参加エラー: " + e.message);
  }
}

// ★ 対戦開始の接着剤
function beginActiveMatch(roomId, myRole, roomData) {
  window.currentOnlineMatch = {
    roomId: roomId,
    myRole: myRole,
    opponentRole: myRole === 'player1' ? 'player2' : 'player1',
    timeLimit: roomData.timeLimit,
    resultsShown: false
  };
  
  const opName = roomData[window.currentOnlineMatch.opponentRole].name;
  
  showMatchToast(`⚔️ マッチング成立！<br>VS ${escapeHtml(opName)}<br>対戦を開始します！`, 2500);

  if (roomData.category === 'all') selectedScopePath = ["all"];
  else selectedScopePath = [roomData.category];
  
  const qCountInput = document.getElementById('numQCount');
  if (qCountInput) qCountInput.value = roomData.questionCount;

  setupMatchUI(roomData);

  // リアルタイム同期監視（切断検知もここで行う）
  if (window.matchScoreListener) window.matchScoreListener();
  window.matchScoreListener = firestore.collection('susuru_anki_match_rooms').doc(roomId).onSnapshot(snap => {
    // 相手が退出・切断して部屋が消えた or 破棄ステータスになった場合
    if (!snap.exists || snap.data().status === 'abandoned') {
      if (window.currentOnlineMatch && !window.currentOnlineMatch.resultsShown) {
        window.currentOnlineMatch.resultsShown = true;
        alert("⚠️ 対戦相手との通信が切断されたか、相手が退出しました。\n試合を終了します。");
        endOnlineMatchSequence(null, true);
      }
      return;
    }

    const data = snap.data();

    // Player2: ホストが作成した問題をダウンロードして開始（UI更新より先に処理）
    if (window.currentOnlineMatch && window.currentOnlineMatch.myRole === 'player2' && data.quizPool && quizPool.length === 0) {
        quizPool = data.quizPool;
        quizIndex = 0;
        loadQuizQuestion(); // loadQuizQuestion内でUIも整合される
    }

    try { updateMatchUI(data); } catch(e) { /* matchVsBarがまだない場合は無視 */ }

    // 両方のプレイヤーが終了したか判定
    if (data.player1 && data.player1.finished && data.player2 && data.player2.finished && !window.currentOnlineMatch.resultsShown) {
        window.currentOnlineMatch.resultsShown = true;
        endOnlineMatchSequence(data, false);
    }
  });

  // クイズ画面へ遷移して同期開始処理を呼ぶ
  startQuiz('normal');
}

function setupMatchUI(data) {
  let vsBar = document.getElementById('matchVsBar');
  if (!vsBar) {
    vsBar = document.createElement('div');
    vsBar.id = 'matchVsBar';
    vsBar.style.cssText = 'background:var(--bg2); border:2px solid var(--accent); border-radius:10px; padding:12px; margin-bottom:15px; display:flex; justify-content:space-between; align-items:center; font-weight:bold; box-shadow: 0 4px 15px rgba(0,0,0,0.2);';
    const container = document.querySelector('.quiz-container');
    container.insertBefore(vsBar, container.firstChild);
  }
  updateMatchUI(data);
}

function updateMatchUI(data) {
  const vsBar = document.getElementById('matchVsBar');
  if (!vsBar || !window.currentOnlineMatch) return;
  const me = data[window.currentOnlineMatch.myRole];
  const op = data[window.currentOnlineMatch.opponentRole];
  if (!me || !op) return;
  vsBar.innerHTML = `
    <div style="color:var(--primary); text-align:left;">👤 あなた<br><span style="font-size:1.4rem;">${me.score}点</span></div>
    <div style="color:var(--danger); font-size:1.8rem; font-weight:900; font-style:italic;">VS</div>
    <div style="color:var(--accent); text-align:right;">👤 ${escapeHtml(op.name)}<br><span style="font-size:1.4rem;">${op.score}点</span></div>
  `;
}

// ★ 対戦終了時の結果発表とクリーンアップ
window.endOnlineMatchSequence = function(data, isDisconnected) {
  if (!window.currentOnlineMatch) return;
  const roomId = window.currentOnlineMatch.roomId;
  const myRole = window.currentOnlineMatch.myRole;

  if (!isDisconnected && data) {
    const opRole = window.currentOnlineMatch.opponentRole;
    const myScore = data[myRole].score;
    const opScore = data[opRole].score;
    let msg = `🏁 試合終了！\n\nあなた: ${myScore}点\n相手: ${opScore}点\n\n`;
    if (myScore > opScore) msg += "🎉 おめでとうございます！あなたの勝利です！";
    else if (myScore < opScore) msg += "悔しい！あなたの負けです…！";
    else msg += "🤝 引き分け！ナイスファイト！";
    alert(msg);
  }
  
  // ★ ホストが部屋を削除するお掃除（ゴースト化防止）
  if (myRole === 'player1' || isDisconnected) {
      firestore.collection('susuru_anki_match_rooms').doc(roomId).delete().catch(e=>console.log(e));
  }
  
  // クリーンアップ
  if (window.matchScoreListener) { window.matchScoreListener(); window.matchScoreListener = null; }
  const vsBar = document.getElementById('matchVsBar');
  if (vsBar) vsBar.remove();
  hideMatchToast();
  window.currentOnlineMatch = null;
  quizPool = [];
  
  openPage('pgStats');
};

async function addFriend(uid) {
  if (!currentUser) return alert("ログインが必要です。");
  if (uid === currentUser.uid) return alert("自分自身をフレンドに追加できません。");
  try {
    await firestore.collection('susuru_anki_friends').doc(`${currentUser.uid}_${uid}`).set({ user1: currentUser.uid, user2: uid, addedAt: firebase.firestore.FieldValue.serverTimestamp() });
    await firestore.collection('susuru_anki_friends').doc(`${uid}_${currentUser.uid}`).set({ user1: uid, user2: currentUser.uid, addedAt: firebase.firestore.FieldValue.serverTimestamp() });
    alert("✅ フレンドに追加しました！");
  } catch (e) { alert("⚠️ フレンド追加エラー: " + e.message); }
}

async function removeFriend(uid) {
  if (!currentUser) return;
  try {
    await firestore.collection('susuru_anki_friends').doc(`${currentUser.uid}_${uid}`).delete();
    await firestore.collection('susuru_anki_friends').doc(`${uid}_${currentUser.uid}`).delete();
    alert("✅ フレンドを削除しました。");
  } catch (e) { console.error("削除エラー:", e); }
}

async function loadFriendsForComparison() {
  if (!currentUser) return;
  try {
    const myProfileSnap = await firestore.collection('susuru_anki_profiles').doc(currentUser.uid).get();
    const friends = myProfileSnap.exists ? (myProfileSnap.data().friends || []) : [];
    
    const select = document.getElementById('selCompareFriend');
    select.innerHTML = '<option value="">フレンドを選択...</option>';
    
    for (const friendUid of friends) {
      try {
        const friendSnap = await firestore.collection('susuru_anki_profiles').doc(friendUid).get();
        const friendName = friendSnap.exists ? (friendSnap.data().displayName || friendUid) : friendUid;
        const opt = document.createElement('option');
        opt.value = friendUid;
        opt.innerText = friendName;
        select.appendChild(opt);
      } catch(e) {}
    }
    
    const catSelect = document.getElementById('selCompareCategory');
    catSelect.innerHTML = '<option value="">🌐 全カテゴリー</option>';
    categories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.innerText = c;
      catSelect.appendChild(opt);
    });
  } catch(e) {}
}

async function renderCompareStats() {
  const friendUid = document.getElementById('selCompareFriend').value;
  const category = document.getElementById('selCompareCategory').value;
  const area = document.getElementById('compareStatsArea');
  
  if (!friendUid) { area.innerHTML = '<div style="text-align:center; color:var(--text3); padding:40px;">フレンドを選択してください</div>'; return; }
  area.innerHTML = '<div style="text-align:center; color:var(--text2);">読み込み中...</div>';
  
  try {
    const d = getTodayStr();
    const [mySnap, friendSnap] = await Promise.all([
      firestore.collection('susuru_anki_category_scores').where('uid', '==', currentUser.uid).get(),
      firestore.collection('susuru_anki_category_scores').where('uid', '==', friendUid).get()
    ]);
    
    const data = {};
    const processDoc = (doc) => {
      const dObj = doc.data();
      if (dObj.date === d) {
        if (category && dObj.category !== category) return;
        const key = `${dObj.category}_${dObj.uid}`;
        data[key] = dObj;
      }
    };
    mySnap.forEach(processDoc);
    friendSnap.forEach(processDoc);
    
    area.innerHTML = '';
    if (Object.keys(data).length === 0) { area.innerHTML = '<div style="text-align:center; color:var(--text3); padding:40px;">本日の成績データがありません</div>'; return; }
    
    const grouped = {};
    Object.values(data).forEach(item => { if (!grouped[item.category]) grouped[item.category] = []; grouped[item.category].push(item); });
    
    Object.entries(grouped).forEach(([catName, scores]) => {
      const card = document.createElement('div'); card.className = 'card';
      const myScore = scores.find(s => s.uid === currentUser.uid);
      const friendScore = scores.find(s => s.uid === friendUid);
      const myRate = myScore && myScore.total > 0 ? (myScore.score / myScore.total * 100).toFixed(1) : 0;
      const friendRate = friendScore && friendScore.total > 0 ? (friendScore.score / friendScore.total * 100).toFixed(1) : 0;
      const friendName = friendScore ? friendScore.name : '不明';
      card.innerHTML = `
        <div style="font-weight:700; margin-bottom:15px; color:var(--text);">${escapeHtml(catName)}</div>
        <div style="display:flex; gap:15px; margin-bottom:10px;">
          <div style="flex:1;"><div style="font-size:0.8rem; color:var(--text2); margin-bottom:4px;">あなた</div><div style="height:20px; background:var(--bg3); border-radius:4px; overflow:hidden; border:1px solid var(--border);"><div style="width:${myRate}%; height:100%; background:var(--primary); transition:width 0.3s;"></div></div><div style="font-size:0.75rem; color:var(--text2); margin-top:4px;">${myScore ? myScore.score : 0}/${myScore ? myScore.total : 0} (${myRate}%)</div></div>
          <div style="flex:1;"><div style="font-size:0.8rem; color:var(--text2); margin-bottom:4px;">${escapeHtml(friendName)}</div><div style="height:20px; background:var(--bg3); border-radius:4px; overflow:hidden; border:1px solid var(--border);"><div style="width:${friendRate}%; height:100%; background:var(--accent); transition:width 0.3s;"></div></div><div style="font-size:0.75rem; color:var(--text2); margin-top:4px;">${friendScore ? friendScore.score : 0}/${friendScore ? friendScore.total : 0} (${friendRate}%)</div></div>
        </div>
      `;
      area.appendChild(card);
    });
  } catch(e) { area.innerHTML = '<div style="color:var(--danger);">成績データの読み込みに失敗しました</div>'; }
}

let currentChatUid = null;
function openChat(uid, name) { currentChatUid = uid; const chatPartnerName = document.getElementById('chatPartnerName'); const chatPanel = document.getElementById('chatPanel'); if (chatPartnerName) chatPartnerName.innerText = name; if (chatPanel) chatPanel.style.display = 'flex'; }
function closeChat() { const chatPanel = document.getElementById('chatPanel'); if (chatPanel) chatPanel.style.display = 'none'; currentChatUid = null; }
function sendChatMessage() { const chatInput = document.getElementById('chatInput'); const msg = chatInput?.value?.trim(); if (!msg) return; alert("💬 チャット機能は準備中です。\n\nメッセージ: " + msg); if (chatInput) chatInput.value = ''; }
