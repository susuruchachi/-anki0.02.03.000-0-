// ----------------- 画面遷移とメニュー制御 -----------------
function openMenu() {
  document.getElementById('sideMenu').classList.add('open');
  document.getElementById('menuOverlay').classList.add('open');
}

function closeMenu() {
  const sm = document.getElementById('sideMenu');
  const mo = document.getElementById('menuOverlay');
  if(sm) sm.classList.remove('open');
  if(mo) mo.classList.remove('open');
}

function openPage(pageId) { executePageTransition(pageId, false); }

async function fetchAndRenderTutorial() {
  const container = document.getElementById('tutorialContent');
  if (!container || container.getAttribute('data-loaded') === 'true') return; 
  try {
    const res = await fetch('RULES.md');
    if (!res.ok) throw new Error('Failed to load');
    const text = await res.text();
    // marked.jsが読み込まれていれば綺麗に変換、なければそのままテキスト表示
    if (typeof marked !== 'undefined') {
      container.innerHTML = marked.parse(text);
    } else {
      container.innerHTML = `<pre style="white-space:pre-wrap; font-family:inherit;">${escapeHtml(text)}</pre>`;
    }
    container.setAttribute('data-loaded', 'true');
  } catch (e) {
    container.innerHTML = '<p style="color:var(--danger); text-align:center;">ガイドの読み込みに失敗しました。</p>';
  }
}

function executePageTransition(pageId, isBackAction) {
  clearInterval(quizTimer); clearTimeout(autoNextTimeout);
  const activeScreen = document.querySelector('.screen.active');
  const currentId = activeScreen ? activeScreen.id : 'pgHome';
  
  if (!isBackAction && currentId !== pageId) {
    pageHistory.push(currentId);
    history.pushState({ page: pageId }, '', '');
  }
  if (pageId !== 'pgFriends') closeChat();

  document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.style.display='none'; });
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const tgt = document.getElementById(pageId);
  if(tgt) { tgt.style.display='flex'; tgt.classList.add('active'); }

  if(pageId==='pgHome') { const el = document.getElementById('navHome'); if(el) el.classList.add('active'); buildQuizScopeDropdown(); }
  if(pageId==='pgTree') { const el = document.getElementById('navTree'); if(el) el.classList.add('active'); renderTree(); }
  if(pageId==='pgBox') { const el = document.getElementById('navBox'); if(el) el.classList.add('active'); renderBox(); }
  if(pageId==='pgStats') { const el = document.getElementById('navStats'); if(el) el.classList.add('active'); renderStatsAndCharts(); }
  if(pageId==='pgPublicCategories') { loadPublicCategories(); }
  if(pageId==='pgCompareStats') { loadFriendsForComparison(); }
  if(pageId==='pgBackup') { const el = document.getElementById('navBackup'); if(el) el.classList.add('active'); }
  if(pageId==='pgTutorial') { fetchAndRenderTutorial(); } // ★ ガイド読み込みを追加
  
  closeMenu();
}
