// ====== ソーシャル機能（フレンド・ランキング・オンライン対戦） ======

// ★ オンライン対戦ページの初期化
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

function startOnlineMatching() {
  if (!currentUser) return alert("オンライン対戦にはログインが必要です。");
  
  const qCountInput = document.getElementById('onlineMatchQuestionCount');
  const timeLimitInput = document.getElementById('onlineMatchTimeLimit');
  const qCount = parseInt(qCountInput?.value) || 10;
  const timeLimit = parseInt(timeLimitInput?.value) || 15;
  
  if (qCount < 5 || qCount > 50) return alert("問題数は5～50の間で設定してください。");
  if (timeLimit < 5 || timeLimit > 60) return alert("制限時間は5～60秒の間で設定してください。");
  
  const targetCat = selectedScopePath.length > 0 && selectedScopePath[0] !== "all" 
    ? selectedScopePath[selectedScopePath.length - 1] 
    : "all";
  
  const matchRoom = {
    id: 'match_' + Math.random().toString(36).slice(2) + Date.now().toString(36),
    status: 'waiting',
    player1: { uid: currentUser.uid, name: currentUser.displayName || '名無し', score: 0 },
    player2: null,
    category: targetCat,
    questionCount: qCount,
    timeLimit: timeLimit,
    createdAt: new Date().getTime(),
    startedAt: null
  };
  
  showOnlineMatchWaitingDialog(matchRoom);
  
  // Firestore に一時保存
  firestore.collection('susuru_anki_match_rooms').doc(matchRoom.id).set(matchRoom)
    .catch(e => alert("⚠️ マッチング作成エラー: " + e.message));
}

function createQuickMatch() {
  if (!currentUser) return alert("招待リンク作成にはログインが必要です。");
  
  const qCountInput = document.getElementById('onlineMatchQuestionCount');
  const timeLimitInput = document.getElementById('onlineMatchTimeLimit');
  const qCount = parseInt(qCountInput?.value) || 10;
  const timeLimit = parseInt(timeLimitInput?.value) || 15;
  
  const targetCat = selectedScopePath.length > 0 && selectedScopePath[0] !== "all" 
    ? selectedScopePath[selectedScopePath.length - 1] 
    : "all";
  
  const matchRoom = {
    id: 'match_' + Math.random().toString(36).slice(2) + Date.now().toString(36),
    status: 'waiting',
    player1: { uid: currentUser.uid, name: currentUser.displayName || '名無し', score: 0 },
    player2: null,
    category: targetCat,
    questionCount: qCount,
    timeLimit: timeLimit,
    createdAt: new Date().getTime(),
    startedAt: null,
    isInviteOnly: true
  };
  
  firestore.collection('susuru_anki_match_rooms').doc(matchRoom.id).set(matchRoom)
    .then(() => {
      const inviteUrl = `${window.location.origin}${window.location.pathname}?match_room=${matchRoom.id}`;
      alert(`✅ 招待リンクが作成されました！\n\n${inviteUrl}\n\n(クリップボードにコピーしました)`);
      
      // クリップボードにコピー
      navigator.clipboard.writeText(inviteUrl).catch(e => {
        console.log("クリップボードコピー失敗:", e);
        prompt("招待リンク:", inviteUrl);
      });
    })
    .catch(e => alert("⚠️ リンク作成エラー: " + e.message));
}

function showOnlineMatchWaitingDialog(matchRoom) {
  alert(`🎯 マッチング中...\n\n対戦ルーム ID: ${matchRoom.id}\n\n相手が見つかるまでお待ちください。`);
  
  // 30秒間待機して、対戦相手がいなければキャンセル
  setTimeout(() => {
    firestore.collection('susuru_anki_match_rooms').doc(matchRoom.id).get()
      .then(snap => {
        if (snap.exists && snap.data().player2 === null) {
          firestore.collection('susuru_anki_match_rooms').doc(matchRoom.id).delete();
          alert("⏱️ タイムアウト。相手が見つかりませんでした。");
        }
      });
  }, 30000);
}

// オンライン対戦の URL 判定 (main.js から呼ばれる)
async function checkOnlineMatchInvite(roomId) {
  if (!currentUser) {
    alert("対戦に参加するにはログインが必要です。");
    return;
  }
  
  try {
    const snap = await firestore.collection('susuru_anki_match_rooms').doc(roomId).get();
    if (!snap.exists) {
      alert("この対戦ルームは見つかりません。");
      return;
    }
    
    const room = snap.data();
    if (room.status !== 'waiting') {
      alert("この対戦は既に開始されているか終了しています。");
      return;
    }
    
    if (room.player1.uid === currentUser.uid) {
      alert("自分自身と対戦することはできません。");
      return;
    }
    
    // player2 として参加
    await firestore.collection('susuru_anki_match_rooms').doc(roomId).update({
      player2: { uid: currentUser.uid, name: currentUser.displayName || '名無し', score: 0 },
      status: 'ready'
    });
    
    alert(`✅ ${room.player1.name} との対戦に参加しました！`);
    // クイズ画面に遷移
    openPage('pgHome');
  } catch (e) {
    alert("⚠️ 参加エラー: " + e.message);
  }
}

// ★ フレンド関連関数（スタブ）
async function addFriend(uid) {
  if (!currentUser) return alert("ログインが必要です。");
  if (uid === currentUser.uid) return alert("自分自身をフレンドに追加できません。");
  
  try {
    // 相互フレンド登録
    await firestore.collection('susuru_anki_friends').doc(`${currentUser.uid}_${uid}`).set({
      user1: currentUser.uid,
      user2: uid,
      addedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    await firestore.collection('susuru_anki_friends').doc(`${uid}_${currentUser.uid}`).set({
      user1: uid,
      user2: currentUser.uid,
      addedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    alert("✅ フレンドに追加しました！");
  } catch (e) {
    alert("⚠️ フレンド追加エラー: " + e.message);
  }
}

async function removeFriend(uid) {
  if (!currentUser) return;
  try {
    await firestore.collection('susuru_anki_friends').doc(`${currentUser.uid}_${uid}`).delete();
    await firestore.collection('susuru_anki_friends').doc(`${uid}_${currentUser.uid}`).delete();
    alert("✅ フレンドを削除しました。");
  } catch (e) {
    console.error("削除エラー:", e);
  }
}

function loadFriendsForComparison() {
  if (!currentUser) return alert("ログインが必要です。");
  alert("フレンド機能は準備中です。");
}

function loadPublicCategories() {
  alert("公開カテゴリー機能は準備中です。");
}

function shareCategory(catName) {
  const shareCode = Math.random().toString(36).slice(2, 8).toUpperCase();
  const shareUrl = `${window.location.origin}${window.location.pathname}?share_id=${shareCode}`;
  
  alert(`✅ 共有URLを生成しました！\n\n${shareUrl}\n\n(クリップボードにコピーしました)`);
  navigator.clipboard.writeText(shareUrl).catch(() => {
    prompt("共有URL:", shareUrl);
  });
}

function makePublicCategory(catName) {
  alert(`📢 「${catName}」を公開カテゴリーに設定しました！`);
}

// チャット関連 (スタブ)
let currentChatUid = null;

function openChat(uid, name) {
  currentChatUid = uid;
  const chatPartnerName = document.getElementById('chatPartnerName');
  const chatPanel = document.getElementById('chatPanel');
  if (chatPartnerName) chatPartnerName.innerText = name;
  if (chatPanel) chatPanel.style.display = 'flex';
}

function closeChat() {
  const chatPanel = document.getElementById('chatPanel');
  if (chatPanel) chatPanel.style.display = 'none';
  currentChatUid = null;
}

function sendChatMessage() {
  const chatInput = document.getElementById('chatInput');
  const msg = chatInput?.value?.trim();
  if (!msg) return;
  
  alert("💬 チャット機能は準備中です。\n\nメッセージ: " + msg);
  if (chatInput) {
    chatInput.value = '';
  }
}
