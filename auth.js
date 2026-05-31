// ----------------- Firebase Auth -----------------
function firebaseLogin() { 
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ 'prompt': 'select_account' });
  
  auth.signInWithPopup(provider)
    .catch(err => { 
      if (err.code === 'auth/popup-blocked') {
        alert("⚠️ ポップアップがブロックされました。\nブラウザの設定で許可してからお試しください。");
      } else if (err.code === 'auth/cancelled-popup-request') {
        // ユーザーが意図的にポップアップを閉じた場合
        console.log("ログインがキャンセルされました");
      } else { 
        alert("⚠️ ログインエラー: " + err.message); 
      }
    });
}

function firebaseLogout() { 
  auth.signOut()
    .then(() => alert("✅ ログアウトしました"))
    .catch(err => alert("⚠️ ログアウトエラー: " + err.message));
}

auth.onAuthStateChanged(user => {
  currentUser = user;
  const ls = document.getElementById('fbLoginState');
  if(!ls) return;
  
  if(user) {
    ls.innerHTML = `<span style="color:var(--success);">✅ ${escapeHtml(user.displayName || user.email)}</span>`;
    const btnLogin = document.getElementById('btnFbLogin');
    const btnLogout = document.getElementById('btnFbLogout');
    if(btnLogin) btnLogin.style.display = 'none';
    if(btnLogout) btnLogout.style.display = 'inline-flex';
    
    const txtUid = document.getElementById('txtMyUid');
    if(txtUid) txtUid.value = user.uid;
    
    firestore.collection('susuru_anki_profiles').doc(user.uid).set({ 
      displayName: user.displayName||'名無し', 
      uid: user.uid,
      lastLogin: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(e => console.error("プロフィール保存エラー:", e));
    
    syncToCloud(true);
    
    if (typeof currentSharedDocId !== 'undefined' && currentSharedDocId) {
      listenToSharedDoc(currentSharedDocId);
    }
    
    // ★ 管理者UI表示の更新
    if (typeof updateAdminUIVisibility === 'function') updateAdminUIVisibility();
  } else {
    ls.innerHTML = `<span style="color:var(--warn);">未ログイン</span>`;
    const btnLogin = document.getElementById('btnFbLogin');
    const btnLogout = document.getElementById('btnFbLogout');
    if(btnLogin) btnLogin.style.display = 'inline-flex';
    if(btnLogout) btnLogout.style.display = 'none';
    
    const txtUid = document.getElementById('txtMyUid');
    if(txtUid) txtUid.value = '';
    
    // ★ 管理者UI表示の更新（非管理者の場合は非表示）
    if (typeof updateAdminUIVisibility === 'function') updateAdminUIVisibility();
  }
});
