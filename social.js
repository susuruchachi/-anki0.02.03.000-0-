// ★★★ すするanki0.02.50-g - ソーシャル機能（ランキング・フレンド・チャット・成績比較・オンライン対戦） ★★★

// ★ グローバル変数の安全な初期化
window.shareStats = localStorage.getItem('shareStats') === 'true';

// ★ 本日のデイリーランキング表示
async function loadDailyRanking() {
  const listDiv = document.getElementById('rankingList');
  if (!currentUser) { listDiv.innerHTML = 'ログインしてください'; return; }
  const d = getTodayStr();
  try {
    listDiv.innerHTML = '(読み込み中...)';
    const snap = await firestore.collection('susuru_anki_daily_scores').where('date', '==', d).get();
    
    if(snap.empty) { listDiv.innerHTML = 'まだ今日のスコアがありません。あなたが1番乗りです！'; return; }
    
    let scores = [];
    snap.forEach(doc => scores.push(doc.data()));
    scores.sort((a, b) => (b.score || 0) - (a.score || 0));
    scores = scores.slice(0, 10);
    
    listDiv.innerHTML = '';
    let rank = 1;
    scores.forEach(data => {
      listDiv.innerHTML += `<div><span style="display:inline-block; width:24px; color:var(--warn); font-weight:bold;">${rank}</span>: ${escapeHtml(data.name)} <span style="color:var(--success); font-weight:bold;">(${data.score}問)</span></div>`;
      rank++;
    });
  } catch(e) {
    console.error(e);
    listDiv.innerHTML = '<span style="color:var(--danger)">ランキング取得エラー (通信状況等をご確認ください)</span>';
  }
}

// ★ 自分のUIDをクリップボードにコピー
function copyMyUid() {
  const uid = document.getElementById('txtMyUid').value; 
  if (!uid) return alert("ログインが必要です。");
  navigator.clipboard.writeText(uid).then(() => alert("✅ UIDをコピーしました！"));
}

// ★ フレンド追加（双方向登録）
async function addAppFriend() {
  const fUid = document.getElementById('txtAddFriendUid').value.trim();
  if (!fUid) return alert("UIDを入力してください。"); 
  if (!currentUser) return alert("ログインが必要です。"); 
  if (fUid === currentUser.uid) return alert("自分自身は登録できません。");
  try {
    await firestore.collection('susuru_anki_profiles').doc(currentUser.uid).set({ friends: firebase.firestore.FieldValue.arrayUnion(fUid) }, { merge: true });
    await firestore.collection('susuru_anki_profiles').doc(fUid).set({ friends: firebase.firestore.FieldValue.arrayUnion(currentUser.uid) }, { merge: true });
    document.getElementById('txtAddFriendUid').value = ''; 
    alert("✅ フレンドを追加しました！"); 
    loadAppFriends();
  } catch (e) { alert("⚠️ フレンド追加に失敗しました。ルールの確認を。"); }
}

// ★ フレンド一覧を読み込んで表示
async function loadAppFriends() {
  const listDiv = document.getElementById('appFriendsList'); 
  listDiv.innerHTML = '<p style="color:var(--text3); font-size:0.8rem; text-align:center;">読み込み中...</p>';
  if (!currentUser) { listDiv.innerHTML = '<p style="color:var(--danger); font-size:0.85rem; text-align:center;">ログインしてください</p>'; return; }
  try {
    const myProfileSnap = await firestore.collection('susuru_anki_profiles').doc(currentUser.uid).get();
    const friends = myProfileSnap.exists ? (myProfileSnap.data().friends || []) : [];
    if (friends.length === 0) { listDiv.innerHTML = '<p style="color:var(--text3); font-size:0.85rem; text-align:center;">フレンドはいません。</p>'; return; }
    listDiv.innerHTML = '';
    for (const fUid of friends) {
      const fProfSnap = await firestore.collection('susuru_anki_profiles').doc(fUid).get();
      const fName = fProfSnap.exists ? fProfSnap.data().displayName : '未登録ユーザー';
      const div = document.createElement('div'); div.className = 'achieve-row';
      div.innerHTML = `<div class="achieve-label">👤 ${escapeHtml(fName)}</div><button class="btn" style="width:auto; padding:6px 12px; font-size:0.8rem;" onclick="openChat('${fUid}', '${escapeHtml(fName)}')">💬</button>`;
      listDiv.appendChild(div);
    }
  } catch (e) { listDiv.innerHTML = '<p style="color:var(--danger); font-size:0.8rem; text-align:center;">エラーが発生しました。</p>'; }
}

let currentChatUnsubscribe = null, currentChatFriendUid = null;
function getChatId(uid1, uid2) { return [uid1, uid2].sort().join('_'); }

function openChat(friendUid, friendName) {
  document.getElementById('friendsListArea').style.display = 'none'; 
  document.getElementById('chatArea').style.display = 'flex'; 
  document.getElementById('chatWithTitle').innerText = friendName + " とのチャット";
  currentChatFriendUid = friendUid; 
  const chatId = getChatId(currentUser.uid, friendUid); 
  const msgBox = document.getElementById('chatMessages'); 
  msgBox.innerHTML = '履歴を取得中...';
  
  if (currentChatUnsubscribe) currentChatUnsubscribe();
  currentChatUnsubscribe = firestore.collection('susuru_anki_chats').doc(chatId).collection('messages').orderBy('timestamp', 'asc').onSnapshot(snap => {
    msgBox.innerHTML = ''; 
    if (snap.empty) { msgBox.innerHTML = '<div style="color:var(--text3); text-align:center; font-size:0.8rem;">まだメッセージがありません。</div>'; }
    snap.forEach(doc => {
      const data = doc.data(); const isMe = data.senderId === currentUser.uid;
      const wrap = document.createElement('div'); wrap.style.cssText = `display:flex; flex-direction:column; max-width:80%; ${isMe ? 'align-self:flex-end;' : 'align-self:flex-start;'}`;
      const bubble = document.createElement('div'); bubble.style.cssText = `padding:10px 14px; border-radius:14px; font-size:0.9rem; word-break:break-all; ${isMe ? 'background:var(--primary); color:#fff; border-bottom-right-radius:2px;' : 'background:var(--bg3); border:1px solid var(--border); color:var(--text); border-bottom-left-radius:2px;'}`;
      bubble.innerText = data.text; wrap.appendChild(bubble); msgBox.appendChild(wrap);
    });
    msgBox.scrollTop = msgBox.scrollHeight;
  });
}

function closeChat() { 
  if (currentChatUnsubscribe) { currentChatUnsubscribe(); currentChatUnsubscribe = null; } 
  document.getElementById('chatArea').style.display = 'none'; 
  document.getElementById('friendsListArea').style.display = 'flex'; 
  currentChatFriendUid = null; 
}

async function sendChatMessage() {
  const input = document.getElementById('txtChatInput'); 
  const text = input.value.trim(); 
  if (!text || !currentChatFriendUid) return;
  const chatId = getChatId(currentUser.uid, currentChatFriendUid);
  try { 
    await firestore.collection('susuru_anki_chats').doc(chatId).collection('messages').add({ text: text, senderId: currentUser.uid, timestamp: firebase.firestore.FieldValue.serverTimestamp() }); 
    input.value = ''; 
  } catch (e) { alert("⚠️ エラーが発生しました。"); }
}

// ★ カテゴリー別ランキング
async function loadCategoryRanking(catName) {
  const listDiv = document.getElementById('categoryRankingList');
  if (!currentUser) { listDiv.innerHTML = 'ログインしてください'; return; }
  const d = getTodayStr();
  try {
    listDiv.innerHTML = '(読み込み中...)';
    const snap = await firestore.collection('susuru_anki_category_scores').where('date', '==', d).where('category', '==', catName).get();
    
    if(snap.empty) { listDiv.innerHTML = `このカテゴリーはまだスコアがありません。`; return; }
    
    let scores = [];
    snap.forEach(doc => scores.push(doc.data()));
    scores.sort((a, b) => (b.score || 0) - (a.score || 0));
    scores = scores.slice(0, 10);
    
    listDiv.innerHTML = '';
    let rank = 1;
    scores.forEach(data => {
      listDiv.innerHTML += `<div class="card" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; padding:10px;"><span style="color:var(--warn); font-weight:bold; font-size:1.1rem;">#${rank}</span><span>${escapeHtml(data.name || 'Unknown')}</span><span style="color:var(--success); font-weight:bold;">${data.score || 0}問</span></div>`;
      rank++;
    });
  } catch(e) {
    console.error(e);
    listDiv.innerHTML = '<span style="color:var(--danger)">ランキング取得エラー</span>';
  }
}

// ★ 成績保存 (shareStatsのクラッシュ対策済み)
async function recordCategoryScore(catName, isCorrect) {
  const isShared = typeof window.shareStats !== 'undefined' ? window.shareStats : (localStorage.getItem('shareStats') === 'true');
  if(!currentUser || !isShared) return;

  const d = getTodayStr();
  const ref = firestore.collection('susuru_anki_category_scores').doc(`${d}_${currentUser.uid}_${catName}`);
  try {
    await ref.set({
      date: d,
      category: catName,
      uid: currentUser.uid,
      name: currentUser.displayName || 'Anonymous',
      score: firebase.firestore.FieldValue.increment(isCorrect ? 1 : 0),
      total: firebase.firestore.FieldValue.increment(1)
    }, { merge: true });
  } catch(e) {}
}

// ★ 成績共有設定のトグル
function toggleShareStats() {
  const chk = document.getElementById('chkShareStats');
  window.shareStats = chk.checked;
  localStorage.setItem('shareStats', window.shareStats);
  alert(window.shareStats ? '✅ 成績共有を有効にしました' : '✅ 成績共有を無効にしました');
}

// ★ フレンド成績比較ページ用
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
  
  if (!friendUid) {
    area.innerHTML = '<div style="text-align:center; color:var(--text3); padding:40px;">フレンドを選択してください</div>';
    return;
  }
  
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
    
    if (Object.keys(data).length === 0) {
      area.innerHTML = '<div style="text-align:center; color:var(--text3); padding:40px;">本日の成績データがありません</div>';
      return;
    }
    
    const grouped = {};
    Object.values(data).forEach(item => {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    });
    
    Object.entries(grouped).forEach(([catName, scores]) => {
      const card = document.createElement('div');
      card.className = 'card';
      
      const myScore = scores.find(s => s.uid === currentUser.uid);
      const friendScore = scores.find(s => s.uid === friendUid);
      
      const myRate = myScore && myScore.total > 0 ? (myScore.score / myScore.total * 100).toFixed(1) : 0;
      const friendRate = friendScore && friendScore.total > 0 ? (friendScore.score / friendScore.total * 100).toFixed(1) : 0;
      const friendName = friendScore ? friendScore.name : '不明';
      
      card.innerHTML = `
        <div style="font-weight:700; margin-bottom:15px; color:var(--text);">${escapeHtml(catName)}</div>
        <div style="display:flex; gap:15px; margin-bottom:10px;">
          <div style="flex:1;">
            <div style="font-size:0.8rem; color:var(--text2); margin-bottom:4px;">あなた</div>
            <div style="height:20px; background:var(--bg3); border-radius:4px; overflow:hidden; border:1px solid var(--border);">
              <div style="width:${myRate}%; height:100%; background:var(--primary); transition:width 0.3s;"></div>
            </div>
            <div style="font-size:0.75rem; color:var(--text2); margin-top:4px;">${myScore ? myScore.score : 0}/${myScore ? myScore.total : 0} (${myRate}%)</div>
          </div>
          <div style="flex:1;">
            <div style="font-size:0.8rem; color:var(--text2); margin-bottom:4px;">${escapeHtml(friendName)}</div>
            <div style="height:20px; background:var(--bg3); border-radius:4px; overflow:hidden; border:1px solid var(--border);">
              <div style="width:${friendRate}%; height:100%; background:var(--accent); transition:width 0.3s;"></div>
            </div>
            <div style="font-size:0.75rem; color:var(--text2); margin-top:4px;">${friendScore ? friendScore.score : 0}/${friendScore ? friendScore.total : 0} (${friendRate}%)</div>
          </div>
        </div>
      `;
      area.appendChild(card);
    });
  } catch(e) {
    console.error(e);
    area.innerHTML = '<div style="color:var(--danger);">成績データの読み込みに失敗しました</div>';
  }
}

// ====== ⚔️ オンライン対戦機能 ======
let currentMatchId = null;
let matchUnsubscribe = null;
let matchQuestions = [];
let matchCurrentIdx = 0;
let matchScore = 0;
let matchTimer = null;
let matchTimeLeft = 0;
let matchQuizFormat = 'desc';
let matchGameStarted = false;
let matchTimeLimitVal = 15;
let matchIsPlayer1 = true;
let matchOppName = '相手';
let matchLastOppProgress = 0;

function initOnlineMatchPage() {
  const container = document.getElementById('onlineMatchScopeSelectors');
  if (container) {
    container.innerHTML = '';
    createOnlineMatchScopeSelect(0, getTopLevelCategories());
  }
  const gameView = document.getElementById('onlineGameView');
  if (gameView) gameView.style.display = 'none';
  updateOnlineWaitingCount();
}

function createOnlineMatchScopeSelect(depth, categoriesToShow) {
  if (categoriesToShow.length === 0) return;
  const container = document.getElementById('onlineMatchScopeSelectors');
  if (!container) return;

  const select = document.createElement('select');
  select.className = 'form-control';
  select.style.marginBottom = '8px';

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
      updateOnlineWaitingCount();
      return;
    }
    
    selectedScopePath[depth] = val;
    selectedScopePath = selectedScopePath.slice(0, depth + 1);
    const children = categoryTree[val] || [];
    if (children.length > 0) {
      createOnlineMatchScopeSelect(depth + 1, children);
    }
    updateOnlineWaitingCount();
  };
  
  container.appendChild(select);
}

async function updateOnlineWaitingCount() {
  const el = document.getElementById('onlineWaitingCountBadge');
  if (!el) return;
  const scope = selectedScopePath.length > 0 && selectedScopePath[0] !== 'all' ? selectedScopePath[selectedScopePath.length - 1] : 'all';
  try {
    const snap = await firestore.collection('susuru_anki_matches')
      .where('status', '==', 'waiting')
      .where('scope', '==', scope)
      .get();
    const count = snap.docs.filter(d => d.data().isPrivate === false).length;
    el.textContent = count > 0 ? `🟢 このカテゴリーで ${count}人 が待機中` : '⚪ 現在このカテゴリーで待機中の人はいません';
    el.style.color = count > 0 ? 'var(--success)' : 'var(--text3)';
  } catch(e) {
    console.warn('待機人数取得エラー:', e);
    el.textContent = '';
  }
}

function startOnlineMatching() {
  if (!currentUser) return alert("オンライン対戦にはログインが必要です。");
  const qCount = parseInt(document.getElementById('onlineMatchQuestionCount').value) || 10;
  const timeLimit = parseInt(document.getElementById('onlineMatchTimeLimit').value) || 15;
  const quizFormat = document.getElementById('onlineMatchFormat').value || 'desc';
  const scope = selectedScopePath.length > 0 && selectedScopePath[0] !== "all" ? selectedScopePath[selectedScopePath.length - 1] : "all";
  
  startOnlineMatch(scope, qCount, timeLimit, false, quizFormat);
}

function createQuickMatch() {
  if (!currentUser) return alert("招待リンク作成にはログインが必要です。");
  const qCount = parseInt(document.getElementById('onlineMatchQuestionCount').value) || 10;
  const timeLimit = parseInt(document.getElementById('onlineMatchTimeLimit').value) || 15;
  const quizFormat = document.getElementById('onlineMatchFormat').value || 'desc';
  const scope = selectedScopePath.length > 0 && selectedScopePath[0] !== "all" ? selectedScopePath[selectedScopePath.length - 1] : "all";
  
  startOnlineMatch(scope, qCount, timeLimit, true, quizFormat);
}

async function startOnlineMatch(scope, qCount, timeLimit, isPrivate, quizFormat = 'desc') {
  showOnlineMatchOverlay("🔍 対戦相手を探しています...");
  
  try {
    if (!isPrivate) {
      const snap = await firestore.collection('susuru_anki_matches')
        .where('status', '==', 'waiting')
        .where('scope', '==', scope)
        .get();
        
      const availableMatches = snap.docs.filter(d => {
        const data = d.data();
        return data.qCount === qCount &&
               data.isPrivate === false &&
               data.quizFormat === quizFormat &&
               data.player1 !== currentUser.uid;
      });
        
      if (availableMatches.length > 0) {
        const doc = availableMatches[0];
        currentMatchId = doc.id;
        await firestore.collection('susuru_anki_matches').doc(currentMatchId).update({
          status: 'playing',
          player2: currentUser.uid,
          player2Name: currentUser.displayName || '名無し'
        });
        listenToMatch();
        return;
      }
    }
    
    let pool = [];
    if (scope === 'all') {
      pool = [...db];
    } else {
      const subCats = typeof getAllSubcategories === 'function' ? getAllSubcategories(scope) : [scope];
      pool = db.filter(q => subCats.includes(q.category));
    }
    if (pool.length === 0) pool = [...db];
    if (pool.length === 0) {
      removeOnlineMatchOverlay();
      return alert("⚠️ 出題できる問題カードがありません。先にカードを作成してください。");
    }
    
    pool.sort(() => Math.random() - 0.5);
    const selectedQuestions = pool.slice(0, qCount).map(q => ({
      id: q.id, question: q.question, answer: q.answer
    }));
    
    const matchData = {
      status: 'waiting',
      player1: currentUser.uid,
      player1Name: currentUser.displayName || '名無し',
      player2: null,
      player2Name: null,
      scope: scope,
      qCount: qCount,
      timeLimit: timeLimit,
      isPrivate: isPrivate,
      quizFormat: quizFormat,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      questions: selectedQuestions,
      player1Score: null,
      player2Score: null,
      player1Finished: false,
      player2Finished: false,
      player1Progress: 0,
      player2Progress: 0
    };
    
    const ref = await firestore.collection('susuru_anki_matches').add(matchData);
    currentMatchId = ref.id;
    
    if (isPrivate) {
      const inviteLink = `${window.location.origin}${window.location.pathname}?match_id=${currentMatchId}`;
      showOnlineMatchOverlay(`
        <span style="font-size:0.95rem; font-weight:bold; color:var(--warn);">📋 招待リンクが完成しました</span><br><br>
        <input type="text" value="${inviteLink}" id="inviteLinkInput" readonly style="width:100%; padding:8px; background:var(--bg3); color:var(--text); border:1px solid var(--border); border-radius:6px; text-align:center; font-size:0.8rem;"><br>
        <button class="btn" style="margin-top:10px; padding:6px 14px; font-size:0.8rem; width:auto;" onclick="copyInviteLink()">🔗 リンクをコピー</button><br><br>
        <span style="font-size:0.8rem; color:var(--text2);">相手が参加するまでこのままお待ちください...</span>
      `, true);
    }
    
    listenToMatch();
  } catch (e) {
    console.error(e);
    removeOnlineMatchOverlay();
    alert("対戦ルームの作成に失敗しました: " + e.message);
  }
}

window.copyInviteLink = function() {
  const input = document.getElementById('inviteLinkInput');
  if (input) {
    input.select();
    document.execCommand('copy');
    alert('✅ 招待リンクをコピーしました！友達に共有してください。');
  }
}

let matchOppProgressCallback = null; 

function listenToMatch() {
  if (matchUnsubscribe) matchUnsubscribe();
  matchGameStarted = false;
  matchLastOppProgress = 0;
  
  matchUnsubscribe = firestore.collection('susuru_anki_matches').doc(currentMatchId)
    .onSnapshot((doc) => {
      if (!doc.exists) {
        // ★【0.02.50-g追加】相手の切断等でルームが削除された場合
        if (currentMatchId) {
          alert("❌ ルームが解散されました。");
          if (typeof quitOnlineMatchUI === 'function') quitOnlineMatchUI();
        }
        return;
      }
      
      const data = doc.data();
      
      // ★【0.02.50-g追加】相手が退出または切断した時の終了処理
      let myRole = data.player1 === currentUser.uid ? 'player1' : (data.player2 === currentUser.uid ? 'player2' : null);
      window.myMatchRole = myRole; // main.jsでの退出通知用に保持
      let enemyRole = myRole === 'player1' ? 'player2' : 'player1';
      
      if (data.status === 'playing' && data[`${enemyRole}Disconnected`] === true) {
        if (matchUnsubscribe) { matchUnsubscribe(); matchUnsubscribe = null; }
        if (typeof removeOnlineMatchOverlay === 'function') removeOnlineMatchOverlay();
        alert("❌ 相手が退出しました。対戦を終了します。");
        
        firestore.collection('susuru_anki_matches').doc(currentMatchId).delete().catch(() => {});
        currentMatchId = null;
        localStorage.removeItem('susuru_anki_last_match');
        if (typeof quitOnlineMatchUI === 'function') quitOnlineMatchUI();
        return;
      }
      
      if (data.status === 'playing') {
        const isPlayer1 = data.player1 === currentUser.uid;
        const myFinished = isPlayer1 ? data.player1Finished : data.player2Finished;
        const oppProgress = isPlayer1 ? (data.player2Progress || 0) : (data.player1Progress || 0);
        matchLastOppProgress = oppProgress;
        
        if (!matchGameStarted && !myFinished) {
          matchGameStarted = true;
          matchIsPlayer1 = isPlayer1;
          matchOppName = isPlayer1 ? (data.player2Name || '相手') : (data.player1Name || '相手');
          matchQuestions = data.questions || [];
          matchCurrentIdx = isPlayer1 ? (data.player1Progress || 0) : (data.player2Progress || 0);
          matchScore = isPlayer1 ? (data.player1Score || 0) : (data.player2Score || 0);
          matchQuizFormat = data.quizFormat || 'choice';
          startOnlineGameUI(data);
        }
        
        if (matchOppProgressCallback) {
          matchOppProgressCallback(oppProgress, data);
        }
        
        if (data.player1Finished && data.player2Finished) {
          showMatchResult(data);
          if (matchUnsubscribe) { matchUnsubscribe(); matchUnsubscribe = null; }
        } else if (myFinished) {
          updateGameWaitingStatus(data);
        }
      }
    }, (err) => console.error(err));
}

function startOnlineGameUI(matchData) {
  removeOnlineMatchOverlay();
  const pg = document.getElementById('pgOnlineMatch');
  if (!pg) return;
  
  Array.from(pg.children).forEach(child => {
    if (child.id !== 'onlineGameView') child.style.display = 'none';
  });
  
  let gameView = document.getElementById('onlineGameView');
  if (!gameView) {
    gameView = document.createElement('div');
    gameView.id = 'onlineGameView';
    gameView.style.cssText = 'width:100%; flex:1; display:flex; flex-direction:column; padding:16px;';
    pg.appendChild(gameView);
  }
  gameView.style.display = 'flex';
  
  matchTimeLimitVal = matchData.timeLimit || 15;
  renderOnlineQuestion(matchTimeLimitVal);
}

function showOnlineFeedback(isCorrect, correctAnswer, timeLimit, onNext) {
  const gameView = document.getElementById('onlineGameView');
  if (!gameView) return;
  const color = isCorrect ? 'var(--success)' : 'var(--danger)';
  const icon = isCorrect ? '⭕' : '❌';
  const feedbackDiv = document.createElement('div');
  feedbackDiv.style.cssText = `position:fixed; bottom:80px; left:50%; transform:translateX(-50%); background:${color}; color:#fff; padding:10px 20px; border-radius:10px; font-size:0.95rem; font-weight:bold; z-index:999; text-align:center; max-width:320px;`;
  feedbackDiv.innerHTML = `${icon} 正解: ${escapeHtml(correctAnswer)}`;
  document.body.appendChild(feedbackDiv);
  setTimeout(() => {
    feedbackDiv.remove();
    onNext();
  }, 900);
}

async function advanceToNextQuestion() {
  if (!currentMatchId) { renderOnlineQuestion(matchTimeLimitVal); return; }
  const nextIdx = matchCurrentIdx;
  
  if (nextIdx >= matchQuestions.length) {
    matchOppProgressCallback = null;
    finishOnlineGame();
    return;
  }
  
  const updateField = matchIsPlayer1 ? 'player1Progress' : 'player2Progress';
  firestore.collection('susuru_anki_matches').doc(currentMatchId)
    .update({ [updateField]: nextIdx })
    .catch(e => console.warn('Progress更新エラー:', e));
  
  showOnlineWaitingForOpp(nextIdx, matchOppName);
}

function showOnlineWaitingForOpp(waitingForIdx, oppName) {
  const gameView = document.getElementById('onlineGameView');
  if (!gameView) return;
  
  const qNum = waitingForIdx + 1;
  
  gameView.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem; color:var(--text2); margin-bottom:12px;">
      <span>⚔️ オンライン対戦中</span>
      <span>🎯 問題: ${qNum} / ${matchQuestions.length}</span>
    </div>
    <div style="flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; padding:24px; gap:16px;">
      <div style="font-size:2rem;">⏳</div>
      <div style="font-size:1rem; font-weight:bold; color:var(--text);">次の問題を準備中...</div>
      <div style="font-size:0.9rem; color:var(--text2);">🔄 ${escapeHtml(oppName)} が回答中です</div>
      <div style="background:var(--bg3); border:1px solid var(--border); border-radius:8px; padding:12px; width:100%; font-size:0.85rem; color:var(--text2); text-align:center;">
        両者が解答し終えたら次の問題へ進みます
      </div>
    </div>
  `;
  
  if (matchLastOppProgress >= waitingForIdx) {
    matchOppProgressCallback = null;
    renderOnlineQuestion(matchTimeLimitVal);
    return;
  }
  matchOppProgressCallback = (oppProgress) => {
    if (oppProgress >= waitingForIdx) {
      matchOppProgressCallback = null;
      renderOnlineQuestion(matchTimeLimitVal);
    }
  };
}

function renderOnlineQuestion(timeLimit) {
  const gameView = document.getElementById('onlineGameView');
  if (!gameView || matchCurrentIdx >= matchQuestions.length) {
    finishOnlineGame();
    return;
  }
  
  const q = matchQuestions[matchCurrentIdx];
  const fmt = matchQuizFormat || 'choice';
  
  const headerHtml = `
    <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem; color:var(--text2); margin-bottom:12px;">
      <span>⚔️ オンライン対戦中</span>
      <span>🎯 問題: ${matchCurrentIdx + 1} / ${matchQuestions.length}</span>
    </div>
    <div style="background:var(--bg3); border:1px solid var(--border); border-radius:8px; height:6px; width:100%; margin-bottom:20px; overflow:hidden;">
      <div id="onlineTimerBar" style="background:var(--accent); height:100%; width:100%; transition: width 1s linear;"></div>
    </div>
    <div style="flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; background:var(--bg2); border:1px solid var(--border); border-radius:12px; padding:24px; min-height:140px; margin-bottom:20px; text-align:center;">
      <div style="font-size:1.15rem; font-weight:bold; word-break:break-all; white-space:pre-wrap;">${escapeHtml(q.question)}</div>
    </div>
  `;
  
  if (fmt === 'choice') {
    const correctPrimary = (typeof getPrimaryAnswer === 'function') ? getPrimaryAnswer(q.answer) : q.answer.split(/[/|]/)[0].trim();
    let dummys = [...new Set(db.filter(item => item.answer !== q.answer).map(item => (typeof getPrimaryAnswer === 'function') ? getPrimaryAnswer(item.answer) : item.answer.split(/[/|]/)[0].trim()))];
    dummys.sort(() => Math.random() - 0.5);
    let choices = [correctPrimary];
    for (let i = 0; i < 3; i++) { if (dummys[i]) choices.push(dummys[i]); else choices.push(`ダミー候補 ${i+1}`); }
    choices.sort(() => Math.random() - 0.5);
    gameView.innerHTML = headerHtml + `
      <div style="display:grid; grid-template-columns:1fr; gap:10px; margin-bottom:20px;">
        ${choices.map((c, i) => `<button class="btn btn-secondary online-choice-btn" style="justify-content:center; padding:12px; font-size:0.9rem; text-align:center; word-break:break-all;" id="onlineChoiceBtn_${i}">${escapeHtml(c)}</button>`).join('')}
      </div>
    `;
    choices.forEach((c, i) => {
      const btn = document.getElementById('onlineChoiceBtn_' + i);
      if (btn) btn.onclick = () => submitOnlineAnswer(c, correctPrimary);
    });

  } else if (fmt === 'desc') {
    gameView.innerHTML = headerHtml + `
      <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px;">
        <input type="text" id="onlineDescInput" class="form-control" placeholder="答えを入力..." style="font-size:1rem;" autocomplete="off">
        <button class="btn btn-accent" style="width:100%;" onclick="submitOnlineDescAnswer()">✅ 送信</button>
      </div>
    `;
    const inp = document.getElementById('onlineDescInput');
    if (inp) {
      inp.focus();
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitOnlineDescAnswer(); });
    }
    
  } else if (fmt === 'minhaya') {
    gameView.innerHTML = headerHtml + `<div id="onlineMinhayaArea"></div>`;
    renderOnlineMinhaya(q, timeLimit);
    
  } else if (fmt === 'tap') {
    gameView.innerHTML = headerHtml + `
      <div style="margin-bottom:20px;">
        <div id="onlineTapInput" style="min-height:40px; background:var(--bg3); border:1px solid var(--border); border-radius:8px; padding:8px; text-align:center; font-size:1.1rem; font-weight:bold; margin-bottom:10px; letter-spacing:2px;"></div>
        <div id="onlineTapChoices" style="display:flex; flex-wrap:wrap; gap:8px; justify-content:center;"></div>
        <button class="btn btn-secondary" style="width:100%; margin-top:10px;" onclick="submitOnlineTapAnswer()">✅ 送信</button>
      </div>
    `;
    renderOnlineTap(q);
    
  } else if (fmt === 'self') {
    gameView.innerHTML = headerHtml + `
      <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px; align-items:center;">
        <div id="onlineSelfAnswerDisplay" style="display:none; background:var(--bg3); border:1px solid var(--border); border-radius:8px; padding:12px; width:100%; text-align:center; font-size:1rem; font-weight:bold; color:var(--success);"></div>
        <button class="btn btn-secondary" style="width:100%;" id="onlineSelfShowBtn" onclick="showOnlineSelfAnswer()">💡 答えを見る</button>
        <div id="onlineSelfJudge" style="display:none; width:100%; flex-direction:column; gap:8px;">
          <div style="text-align:center; font-size:0.85rem; color:var(--text2);">自己採点：</div>
          <div style="display:flex; gap:8px;">
            <button class="btn" style="flex:1; background:var(--success); color:#fff;" onclick="submitOnlineSelfAnswer(true)">⭕ 正解</button>
            <button class="btn" style="flex:1; background:var(--danger); color:#fff;" onclick="submitOnlineSelfAnswer(false)">❌ 不正解</button>
          </div>
        </div>
      </div>
    `;
  }
  
  clearInterval(matchTimer);
  if (fmt !== 'self') {
    matchTimeLeft = timeLimit;
    const bar = document.getElementById('onlineTimerBar');
    
    matchTimer = setInterval(() => {
      matchTimeLeft--;
      if (bar) bar.style.width = `${(matchTimeLeft / timeLimit) * 100}%`;
      if (matchTimeLeft <= 0) {
        clearInterval(matchTimer);
        matchCurrentIdx++;
        advanceToNextQuestion();
      }
    }, 1000);
  }
}

window.submitOnlineDescAnswer = function() {
  const inp = document.getElementById('onlineDescInput');
  if (!inp) return;
  const val = inp.value.trim();
  clearInterval(matchTimer);
  const q = matchQuestions[matchCurrentIdx];
  const correct = (typeof getPrimaryAnswer === 'function') ? getPrimaryAnswer(q.answer) : q.answer.split(/[/|]/)[0].trim();
  let isOk = false;
  if (typeof isAnswerCorrect === 'function') isOk = isAnswerCorrect(val, q.answer);
  else { const n = s => s.toLowerCase().replace(/[\s　]/g, ''); isOk = n(val) === n(correct); }
  if (isOk) matchScore++;
  matchCurrentIdx++;
  const timeLimit = parseInt(document.getElementById('onlineMatchTimeLimit').value) || 15;
  showOnlineFeedback(isOk, correct, timeLimit, () => advanceToNextQuestion());
}

let onlineMinhayaTarget = '';
let onlineMinhayaPos = 0;

function renderOnlineMinhaya(q, timeLimit) {
  onlineMinhayaTarget = (typeof getPrimaryAnswer === 'function') ? getPrimaryAnswer(q.answer) : q.answer.split(/[/|]/)[0].trim();
  onlineMinhayaPos = 0;
  renderOnlineMinhayaDisplay(q, timeLimit);
}

function renderOnlineMinhayaDisplay(q, timeLimit) {
  const area = document.getElementById('onlineMinhayaArea');
  if (!area) return;
  
  const target = onlineMinhayaTarget;
  const pos = onlineMinhayaPos;
  
  let slotsHtml = '<div style="display:flex; flex-wrap:wrap; gap:4px; justify-content:center; margin-bottom:12px;">';
  for (let i = 0; i < target.length; i++) {
    const filled = i < pos;
    const current = i === pos;
    const bg = filled ? 'var(--success)' : (current ? 'var(--accent)' : 'var(--bg3)');
    const txt = filled ? escapeHtml(target[i]) : (current ? '?' : '＿');
    slotsHtml += `<div style="width:36px; height:36px; display:flex; align-items:center; justify-content:center; background:${bg}; border:1px solid var(--border); border-radius:6px; font-weight:bold; font-size:1.1rem;">${txt}</div>`;
  }
  slotsHtml += '</div>';
  
  if (pos >= target.length) {
    area.innerHTML = slotsHtml + `<div style="text-align:center; color:var(--success); font-weight:bold;">✅ 正解！</div>`;
    return;
  }
  
  const correctChar = target[pos];
  const allChars = [...new Set(
    db.map(item => ((typeof getPrimaryAnswer === 'function') ? getPrimaryAnswer(item.answer) : item.answer.split(/[/|]/)[0].trim())).join('').split('')
  )].filter(c => c && c !== correctChar && !/[\s　]/.test(c));
  allChars.sort(() => Math.random() - 0.5);
  const charChoices = [correctChar];
  for (let i = 0; i < 3; i++) {
    charChoices.push(allChars[i] || `？${i}`);
  }
  charChoices.sort(() => Math.random() - 0.5);
  
  let btnsHtml = '<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px;">';
  charChoices.forEach((ch, i) => {
    btnsHtml += `<button class="btn btn-secondary online-minhaya-btn" style="font-size:1.3rem; font-weight:bold; justify-content:center;" id="onlineMinhayaBtn_${i}">${escapeHtml(ch)}</button>`;
  });
  btnsHtml += '</div>';
  
  area.innerHTML = slotsHtml + btnsHtml;

  charChoices.forEach((ch, i) => {
    const btn = document.getElementById('onlineMinhayaBtn_' + i);
    if (btn) btn.onclick = () => submitOnlineMinhayaChar(ch, correctChar, timeLimit);
  });
}

window.submitOnlineMinhayaChar = function(chosen, correct, timeLimit) {
  if (chosen === correct) {
    onlineMinhayaPos++;
    if (onlineMinhayaPos >= onlineMinhayaTarget.length) {
      clearInterval(matchTimer);
      matchScore++;
      matchCurrentIdx++;
      showOnlineFeedback(true, onlineMinhayaTarget, timeLimit, () => advanceToNextQuestion());
    } else {
      const q = matchQuestions[matchCurrentIdx];
      renderOnlineMinhayaDisplay(q, timeLimit);
    }
  } else {
    clearInterval(matchTimer);
    matchCurrentIdx++;
    showOnlineFeedback(false, onlineMinhayaTarget, timeLimit, () => advanceToNextQuestion());
  }
}

let onlineTapTarget = [];
let onlineTapInput = [];

function renderOnlineTap(q) {
  const primary = (typeof getPrimaryAnswer === 'function') ? getPrimaryAnswer(q.answer) : q.answer.split(/[/|]/)[0].trim();
  onlineTapTarget = primary.split('');
  onlineTapInput = [];
  
  const choicesEl = document.getElementById('onlineTapChoices');
  if (!choicesEl) return;
  
  const targetSet = [...new Set(onlineTapTarget)];
  const allChars = [...new Set(
    db.map(item => ((typeof getPrimaryAnswer === 'function') ? getPrimaryAnswer(item.answer) : item.answer.split(/[/|]/)[0].trim())).join('').split('')
  )].filter(c => c && !targetSet.includes(c) && !/[\s　]/.test(c));
  allChars.sort(() => Math.random() - 0.5);
  
  const pool = [...onlineTapTarget];
  const extra = Math.min(4, allChars.length);
  for (let i = 0; i < extra; i++) pool.push(allChars[i]);
  pool.sort(() => Math.random() - 0.5);
  
  choicesEl.innerHTML = '';
  pool.forEach((ch, idx) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.style.cssText = 'width:48px; height:48px; padding:0; font-size:1.3rem; justify-content:center;';
    btn.id = 'onlineTapBtn_' + idx;
    btn.innerText = ch;
    btn.onclick = () => onlineTapChar(ch, idx);
    choicesEl.appendChild(btn);
  });
  
  updateOnlineTapInput();
}

function onlineTapChar(ch, btnIdx) {
  onlineTapInput.push(ch);
  const btn = document.getElementById('onlineTapBtn_' + btnIdx);
  if (btn) btn.disabled = true;
  updateOnlineTapInput();
}

function updateOnlineTapInput() {
  const el = document.getElementById('onlineTapInput');
  if (el) el.innerText = onlineTapInput.join('');
}

window.submitOnlineTapAnswer = function() {
  clearInterval(matchTimer);
  const inputStr = onlineTapInput.join('');
  const q = matchQuestions[matchCurrentIdx];
  const primary = (typeof getPrimaryAnswer === 'function') ? getPrimaryAnswer(q.answer) : q.answer.split(/[/|]/)[0].trim();
  const isOk = (inputStr === primary);
  if (isOk) matchScore++;
  matchCurrentIdx++;
  const timeLimit = parseInt(document.getElementById('onlineMatchTimeLimit').value) || 15;
  showOnlineFeedback(isOk, primary, timeLimit, () => advanceToNextQuestion());
}

window.showOnlineSelfAnswer = function() {
  const q = matchQuestions[matchCurrentIdx];
  const ansEl = document.getElementById('onlineSelfAnswerDisplay');
  const judgeEl = document.getElementById('onlineSelfJudge');
  const showBtn = document.getElementById('onlineSelfShowBtn');
  if (ansEl) { ansEl.style.display = 'block'; ansEl.innerText = 'A: ' + ((typeof getPrimaryAnswer === 'function') ? getPrimaryAnswer(q.answer) : q.answer.split(/[/|]/)[0].trim()); }
  if (judgeEl) { judgeEl.style.display = 'flex'; }
  if (showBtn) showBtn.style.display = 'none';
}

window.submitOnlineSelfAnswer = function(isCorrect) {
  clearInterval(matchTimer);
  if (isCorrect) matchScore++;
  matchCurrentIdx++;
  advanceToNextQuestion();
}

window.submitOnlineAnswer = function(chosen, correct) {
  clearInterval(matchTimer);
  const isOk = (chosen === correct);
  if (isOk) matchScore++;
  matchCurrentIdx++;
  const timeLimit = parseInt(document.getElementById('onlineMatchTimeLimit').value) || 15;
  showOnlineFeedback(isOk, correct, timeLimit, () => advanceToNextQuestion());
}

async function finishOnlineGame() {
  clearInterval(matchTimer);
  const gameView = document.getElementById('onlineGameView');
  if (gameView) {
    gameView.innerHTML = `
      <div style="flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; padding:24px;">
        <div style="font-size:2rem; margin-bottom:12px;">🏁</div>
        <div style="font-size:1.2rem; font-weight:bold; margin-bottom:6px;">あなたの解答が完了しました！</div>
        <div style="font-size:1.1rem; color:var(--success); font-weight:bold; margin-bottom:20px;">スコア: ${matchScore} / ${matchQuestions.length}</div>
        <div id="matchWaitStatus" style="font-size:0.85rem; color:var(--text2);">🔄 対戦相手の完了を待っています...</div>
      </div>
    `;
  }
  
  try {
    const doc = await firestore.collection('susuru_anki_matches').doc(currentMatchId).get();
    const isPlayer1 = doc.data().player1 === currentUser.uid;
    if (isPlayer1) {
      await firestore.collection('susuru_anki_matches').doc(currentMatchId).update({
        player1Score: matchScore, player1Finished: true
      });
    } else {
      await firestore.collection('susuru_anki_matches').doc(currentMatchId).update({
        player2Score: matchScore, player2Finished: true
      });
    }
  } catch (e) {
    console.error(e);
  }
}

function updateGameWaitingStatus(data) {
  const isPlayer1 = data.player1 === currentUser.uid;
  const oppName = isPlayer1 ? (data.player2Name || "相手") : (data.player1Name || "相手");
  const oppFinished = isPlayer1 ? data.player2Finished : data.player1Finished;
  
  const statusDiv = document.getElementById('matchWaitStatus');
  if (statusDiv) {
    statusDiv.innerText = oppFinished ? `💡 ${oppName} は解き終わっています。結果集計中...` : `🔄 ${oppName} の解答を待っています...`;
  }
  
  if (oppFinished) {
    let ind = document.getElementById('onlineOppFinishedIndicator');
    if (!ind) {
      ind = document.createElement('div');
      ind.id = 'onlineOppFinishedIndicator';
      ind.style.cssText = 'position:fixed; top:60px; left:0; right:0; background:var(--accent); color:#fff; text-align:center; font-size:0.8rem; padding:4px 8px; z-index:998;';
      document.body.appendChild(ind);
    }
    ind.innerText = `✅ ${oppName} は解答済み！あなたも頑張って！`;
  }
}

function showMatchResult(data) {
  const gameView = document.getElementById('onlineGameView');
  if (!gameView) return;
  const ind = document.getElementById('onlineOppFinishedIndicator');
  if (ind) ind.remove();
  
  const isPlayer1 = data.player1 === currentUser.uid;
  const myScore = isPlayer1 ? data.player1Score : data.player2Score;
  const oppScore = isPlayer1 ? data.player2Score : data.player1Score;
  const oppName = isPlayer1 ? (data.player2Name || "相手") : (data.player1Name || "相手");
  
  let title = "引き分け 🤔"; let color = "var(--warn)";
  if (myScore > oppScore) { title = "あなたの勝ち！ 🎉"; color = "var(--success)"; }
  else if (myScore < oppScore) { title = "あなたの負け... 😢"; color = "var(--danger)"; }
  
  gameView.innerHTML = `
    <div style="flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; padding:16px;">
      <div style="font-size:1.5rem; font-weight:bold; color:${color}; margin-bottom:20px;">${title}</div>
      <div style="background:var(--bg3); border:1px solid var(--border); border-radius:10px; padding:16px; width:100%; max-width:300px; margin-bottom:24px; display:flex; flex-direction:column; gap:10px;">
        <div style="display:flex; justify-content:space-between; font-size:0.95rem;">
          <span style="font-weight:bold; color:var(--accent);">あなた:</span><span>${myScore} 問正解</span>
        </div>
        <div style="border-top:1px solid var(--border); padding-top:10px; display:flex; justify-content:space-between; font-size:0.95rem;">
          <span style="color:var(--text2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:140px;">${escapeHtml(oppName)}:</span><span>${oppScore} 問正解</span>
        </div>
      </div>
      <button class="btn" style="width:100%; max-width:180px;" onclick="quitOnlineMatchUI()">ロビーに戻る</button>
    </div>
  `;
}

window.quitOnlineMatchUI = function() {
  const gameView = document.getElementById('onlineGameView');
  if (gameView) { gameView.style.display = 'none'; gameView.innerHTML = ''; }
  const pg = document.getElementById('pgOnlineMatch');
  if (pg) {
    Array.from(pg.children).forEach(child => { if (child.id !== 'onlineGameView') child.style.display = ''; });
  }
  const ind = document.getElementById('onlineOppFinishedIndicator');
  if (ind) ind.remove();
  currentMatchId = null;
  matchGameStarted = false;
  matchOppProgressCallback = null;
  matchLastOppProgress = 0;
  // ★【0.02.50-g追加】正常終了時は復帰用データを削除
  localStorage.removeItem('susuru_anki_last_match');
  initOnlineMatchPage();
}

function showOnlineMatchOverlay(htmlContent, showCancel = true) {
  let overlay = document.getElementById('onlineMatchOverlayZone');
  if (!overlay) {
    overlay = document.createElement('div'); overlay.id = 'onlineMatchOverlayZone';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(8,12,20,0.95); z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:20px; color:var(--text); font-family:sans-serif;';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div style="background:var(--bg2); border:1px solid var(--border); border-radius:12px; padding:20px; width:100%; max-width:360px; text-align:center; box-shadow:0 8px 24px rgba(0,0,0,0.5);">
      <div style="margin-bottom:16px; font-size:1rem; line-height:1.5;">${htmlContent}</div>
      ${showCancel ? `<button class="btn btn-secondary" style="width:100%;" onclick="cancelOnlineMatch()">キャンセル</button>` : ''}
    </div>
  `;
}

function removeOnlineMatchOverlay() {
  const overlay = document.getElementById('onlineMatchOverlayZone');
  if (overlay) overlay.remove();
}

window.cancelOnlineMatch = async function() {
  removeOnlineMatchOverlay();
  if (matchUnsubscribe) { matchUnsubscribe(); matchUnsubscribe = null; }
  if (currentMatchId) {
    try {
      const docRef = firestore.collection('susuru_anki_matches').doc(currentMatchId);
      const doc = await docRef.get();
      if (doc.exists && doc.data().status === 'waiting') await docRef.delete();
    } catch (e) { console.error(e); }
    currentMatchId = null;
    // ★【0.02.50-g追加】キャンセル時も復帰用データを削除
    localStorage.removeItem('susuru_anki_last_match');
  }
}

// 🔗 招待リンクからの自動参加フック処理
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const matchId = urlParams.get('match_id');
    if (matchId && currentUser) {
      if (typeof openPage === 'function') openPage('pgOnlineMatch');
      showOnlineMatchOverlay("⚡ 対戦ルームへ接続中...");
      try {
        const doc = await firestore.collection('susuru_anki_matches').doc(matchId).get();
        if (doc.exists) {
          const data = doc.data();
          if (data.status === 'waiting' && data.player1 !== currentUser.uid) {
            currentMatchId = doc.id;
            await firestore.collection('susuru_anki_matches').doc(currentMatchId).update({
              status: 'playing', player2: currentUser.uid, player2Name: currentUser.displayName || '名無し'
            });
            listenToMatch();
          } else if (data.player1 === currentUser.uid || data.player2 === currentUser.uid) {
            currentMatchId = doc.id; listenToMatch();
          } else {
            removeOnlineMatchOverlay(); alert("⚠️ この対戦はすでに満員か終了しています。");
          }
        } else {
          removeOnlineMatchOverlay(); alert("⚠️ 対戦ルームが見つかりません。");
        }
      } catch (e) { console.error(e); removeOnlineMatchOverlay(); }
    }
  }, 1500);
});
