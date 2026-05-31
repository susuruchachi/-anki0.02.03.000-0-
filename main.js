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
};
