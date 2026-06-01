// ★ すするanki 初期化処理

window.onload = function() {
  loadData(); ensureSystemSanity(); autoMerge();
  buildQuizScopeDropdown(); 
  if(localStorage.getItem('theme_light')==='true') toggleLightMode(true);
  
  // 成績共有設定をUIに反映
  const chkShareStats = document.getElementById('chkShareStats');
  if(chkShareStats) chkShareStats.checked = shareStats;
  
  // ★ 管理者UI表示の初期化
  if (typeof updateAdminUIVisibility === 'function') updateAdminUIVisibility();
  
  history.pushState({ page: 'pgHome' }, '', '');
  window.onpopstate = function(event) {
    if (pageHistory.length > 0) executePageTransition(pageHistory.pop(), true);
    else executePageTransition('pgHome', true);
  };

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('share_id')) { openPage('pgShared'); listenToSharedDoc(urlParams.get('share_id')); }
  
  // 起動時に共有カテゴリーの変更を同期する
  if (typeof syncSubscriptions === 'function') syncSubscriptions();

  // ★【0.02.50-g追加】リロード・復帰時のオンライン対戦チェック
  const lastMatchStr = localStorage.getItem('susuru_anki_last_match');
  if (lastMatchStr) {
    try {
      const lastMatch = JSON.parse(lastMatchStr);
      firestore.collection('susuru_anki_matches').doc(lastMatch.matchId).get().then(doc => {
        // まだルームが playing で残っていれば復帰を確認
        if (doc.exists && doc.data().status === 'playing') {
          if (confirm("⚔️ 前回のオンライン対戦ルームが残っています。復帰しますか？")) {
            currentMatchId = lastMatch.matchId;
            // 切断フラグを解除して復帰
            firestore.collection('susuru_anki_matches').doc(currentMatchId).update({
              [`${lastMatch.myRole}Disconnected`]: false
            }).then(() => {
              if (typeof openPage === 'function') openPage('pgOnlineMatch');
              if (typeof listenToMatch === 'function') listenToMatch();
            });
          }
        }
        localStorage.removeItem('susuru_anki_last_match');
      }).catch(() => localStorage.removeItem('susuru_anki_last_match'));
    } catch (e) {
      localStorage.removeItem('susuru_anki_last_match');
    }
  }
};

// ★【0.02.50-g追加】タブを閉じたりリロードした瞬間に切断フラグを送信
window.addEventListener('beforeunload', () => {
  if (typeof currentMatchId !== 'undefined' && currentMatchId && typeof currentUser !== 'undefined' && currentUser) {
    let role = window.myMatchRole || 'player';
    localStorage.setItem('susuru_anki_last_match', JSON.stringify({ matchId: currentMatchId, myRole: role }));
    
    // ベストエフォートで切断フラグ送信
    firestore.collection('susuru_anki_matches').doc(currentMatchId).get().then(doc => {
      if (doc.exists) {
        let data = doc.data();
        let myRole = data.player1 === currentUser.uid ? 'player1' : (data.player2 === currentUser.uid ? 'player2' : null);
        if (myRole) {
          firestore.collection('susuru_anki_matches').doc(currentMatchId).update({ [`${myRole}Disconnected`]: true });
        }
      }
    });
  }
});
