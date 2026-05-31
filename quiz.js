// ----------------- クイズ機能 -----------------
// ★ エラー強制終了（ReferenceError）を防ぐため、全グローバル変数を明示的に宣言
var quizPool = window.quizPool || [];
var quizIndex = window.quizIndex || 0;
var quizPhase = window.quizPhase || 'q';
var quizTimeLimit = window.quizTimeLimit || 15;
var quizTimeLeft = window.quizTimeLeft || 15;
var quizTimer = window.quizTimer || null;
var autoNextTimeout = window.autoNextTimeout || null;
var selectedChoiceIdx = window.selectedChoiceIdx || null;
var selectedScopePath = window.selectedScopePath || [];
var lastQuizScopePath = window.lastQuizScopePath || [];
var currentQuestionGradThreshold = window.currentQuestionGradThreshold || 5;
var currentCombo = window.currentCombo || 0;
var todayCorrectCount = window.todayCorrectCount || 0;

function buildQuizScopeDropdown() {
  const container = document.getElementById('scopeSelectors'); if(!container) return;
  container.innerHTML = ''; createScopeSelect(0, typeof getTopLevelCategories === 'function' ? getTopLevelCategories() : []);
}
function createScopeSelect(depth, categoriesToShow) {
  if (!categoriesToShow || categoriesToShow.length === 0) return;
  const select = document.createElement('select'); select.className = 'form-control';
  if (depth === 0) { const optAll = document.createElement('option'); optAll.value = "all"; optAll.innerText = "🌐 全てから出題"; select.appendChild(optAll); }
  const optDefault = document.createElement('option'); optDefault.value = ""; optDefault.innerText = depth === 0 ? "📁 トップカテゴリー..." : "📂 サブカテゴリー..."; optDefault.disabled = true; optDefault.selected = true; select.appendChild(optDefault);
  categoriesToShow.forEach(cat => { const opt = document.createElement('option'); opt.value = cat; opt.innerText = depth === 0 ? `📁 ${cat}` : `📂 ${cat}`; select.appendChild(opt); });
  select.onchange = (e) => {
    const val = e.target.value; const container = document.getElementById('scopeSelectors');
    const selects = Array.from(container.querySelectorAll('select')); selects.forEach((sel, idx) => { if (idx > depth) sel.remove(); });
    if (val === "all") { selectedScopePath = ["all"]; return; }
    selectedScopePath[depth] = val; selectedScopePath = selectedScopePath.slice(0, depth + 1);
    const children = typeof categoryTree !== 'undefined' ? (categoryTree[val] || []) : []; 
    if (children.length > 0) createScopeSelect(depth + 1, children);
  };
  document.getElementById('scopeSelectors').appendChild(select);
}

function normalizeAnswer(str) {
  if(!str) return '';
  let s = String(str).replace(/[Ａ-Ｚａ-ｚ０-９]/g, c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).toLowerCase().trim();
  s = s.replace(/擦/g, 'こす');
  s = s.replace(/[、，＼＼ \u3000]+/g, ',');
  return s.split(',').map(x=>x.trim()).filter(x=>x!=='').sort().join(',');
}
function isAnswerCorrect(input, correctAnswer) {
  if (!correctAnswer) return false;
  const norms = String(correctAnswer).split(/[/|]/).map(a => normalizeAnswer(a));
  const inNorm = normalizeAnswer(input);
  return norms.includes(inNorm);
}

async function startQuiz(modeType = 'normal') {
  currentCombo = 0; todayCorrectCount = 0;
  if (lastQuizScopePath.length > 0) selectedScopePath = [...lastQuizScopePath];
  let scope = "all";
  if (selectedScopePath.length > 0 && selectedScopePath[0] !== "all") scope = "cat:" + selectedScopePath[selectedScopePath.length - 1];
  
  const chkGrad = document.getElementById('chkIncludeGrad');
  const includeGrad = chkGrad ? chkGrad.checked : false;
  
  const numQ = document.getElementById('numQCount');
  const limitCount = parseInt(numQ ? numQ.value : 10) || 10;
  
  const numGrad = document.getElementById('numGradThreshold');
  currentQuestionGradThreshold = parseInt(numGrad ? numGrad.value : 5) || 5;

  let subset = typeof db !== 'undefined' ? [...db] : [];
  if (modeType === 'tokkun') subset = subset.filter(q => q.level <= 0 || q.level === -1);
  else if (modeType === 'review') subset = subset.filter(q => q.correct >= currentQuestionGradThreshold);
  else if (!includeGrad) subset = subset.filter(q => q.correct < currentQuestionGradThreshold);

  if(scope.startsWith('cat:') && typeof getAllSubcategories === 'function') {
    const cName = scope.replace('cat:', '');
    const targets = getAllSubcategories(cName);
    subset = subset.filter(q => targets.includes(q.category));
  }

  // ★ オンライン対戦時はホスト（player1）が問題を生成して相手に共有する
  if (window.currentOnlineMatch) {
      if (window.currentOnlineMatch.myRole === 'player1') {
          if(subset.length === 0) { alert("⚠️ 問題が見つかりません。"); return; }
          for (let i = subset.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [subset[i], subset[j]] = [subset[j], subset[i]]; }
          quizPool = subset.slice(0, limitCount);
          const chkSwap = document.getElementById('chkSwapQA');
          if (chkSwap && chkSwap.checked) quizPool = quizPool.map(q => ({ ...q, question: q.answer, answer: q.question }));
          
          if (typeof firestore !== 'undefined') {
              await firestore.collection('susuru_anki_match_rooms').doc(window.currentOnlineMatch.roomId).update({
                  quizPool: quizPool
              }).catch(()=>{});
          }
          quizIndex = 0;
          if (typeof openPage === 'function') openPage('pgQuizPlayer');
          loadQuizQuestion();
      } else {
          // ゲスト（player2）は問題が降ってくるまで待機する
          if (typeof openPage === 'function') openPage('pgQuizPlayer');
          document.getElementById('lblQuizQuestion').innerText = "ホストが問題を作成・同期中...";
          document.getElementById('lblQuizProgress').innerText = "WAIT";
          quizPool = [];
          ['boxChoiceArea','boxDescArea','boxMinhayaArea','boxSelfArea', 'boxTapArea', 'btnQuizAction', 'btnQuizPass'].forEach(id => {
              const el = document.getElementById(id); if(el) el.style.display='none';
          });
      }
      return;
  }

  // 以下通常のソロプレイ処理
  if(subset.length === 0) return alert("⚠️ 条件に合致する問題が見つかりませんでした。");
  const prioritize = (q) => {
    if (q.level === 0 && (q.correct > 0 || q.incorrect > 0)) return 1;
    if (q.level === -1) return 2;
    if (q.correct === 0 && q.incorrect === 0) return 3;
    return 4;
  };

  for (let i = subset.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [subset[i], subset[j]] = [subset[j], subset[i]]; }
  subset.sort((a, b) => prioritize(a) - prioritize(b));
  quizPool = subset.slice(0, limitCount); quizIndex = 0;

  const chkSwap = document.getElementById('chkSwapQA');
  if (chkSwap && chkSwap.checked) quizPool = quizPool.map(q => ({ ...q, question: q.answer, answer: q.question }));
  if (typeof openPage === 'function') openPage('pgQuizPlayer'); 
  loadQuizQuestion();
}

function loadQuizQuestion() {
  quizPhase='q'; selectedChoiceIdx=null; window.currentSelfJudge=null;
  const cur = quizPool[quizIndex];
  if (!cur) return;
  
  const lblProg = document.getElementById('lblQuizProgress'); if(lblProg) lblProg.innerText = `Q ${quizIndex+1}/${quizPool.length}`;
  const lblQ = document.getElementById('lblQuizQuestion'); if(lblQ) lblQ.innerText = cur.question;
  const qFeed = document.getElementById('quizFeedback'); if(qFeed) qFeed.style.display = 'none';
  const txtNote = document.getElementById('txtQuickNote'); if(txtNote) txtNote.value = cur.note || '';

  const chkTTS = document.getElementById('chkTTS');
  if(chkTTS && chkTTS.checked && window.speechSynthesis) {
    window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(cur.question); u.lang='ja-JP'; window.speechSynthesis.speak(u);
  }

  const selMode = document.getElementById('selQuizMode');
  const mode = selMode ? selMode.value : 'normal';
  ['boxChoiceArea','boxDescArea','boxMinhayaArea','boxSelfArea', 'boxTapArea'].forEach(id=>{
      const el = document.getElementById(id); if(el) el.style.display='none';
  });
  
  const btnAction = document.getElementById('btnQuizAction');
  const btnPass = document.getElementById('btnQuizPass');
  if(btnAction) { btnAction.style.display='inline-flex'; btnAction.innerText='確定する'; }
  if(btnPass) { btnPass.style.display='inline-flex'; }

  if(mode==='choice') { const el = document.getElementById('boxChoiceArea'); if(el) el.style.display='grid'; buildFourChoices(cur); }
  else if(mode==='minhaya') { const el = document.getElementById('boxMinhayaArea'); if(el) el.style.display='block'; buildMinhayaMode(cur); if(btnAction) btnAction.style.display='none'; }
  else if(mode==='tap') { const el = document.getElementById('boxTapArea'); if(el) el.style.display='block'; buildTapChoices(cur); if(btnAction) btnAction.style.display='none'; }
  else if(mode==='self') { const el = document.getElementById('boxSelfArea'); if(el) el.style.display='block'; buildSelfMode(cur); if(btnAction) btnAction.style.display='none'; if(btnPass) btnPass.style.display='none'; }
  else { 
      const el = document.getElementById('boxDescArea'); if(el) el.style.display='block'; 
      const txt = document.getElementById('txtDescAnswer'); if(txt) { txt.value=''; txt.disabled=false; txt.focus(); }
  }

  let base = 15;
  if (window.currentOnlineMatch && window.currentOnlineMatch.timeLimit) {
    base = window.currentOnlineMatch.timeLimit;
    if(cur.answer && cur.answer.length > 5) base += Math.min(15, (cur.answer.length - 5) * 1.5);
  } else {
    const selSpeed = document.getElementById('selQuizSpeed');
    const speed = selSpeed ? selSpeed.value : 'normal';
    if(speed==='easy') base=25; else if(speed==='hard') base=10; else if(speed==='expert') base=5;
    if(cur.answer && cur.answer.length > 5) base += Math.min(15, (cur.answer.length - 5) * 1.5);
    const chkTime = document.getElementById('chkTimeAttack');
    if(chkTime && chkTime.checked) base *= 0.5;
  }

  quizTimeLimit = base; quizTimeLeft = base;
  stopQuizTimer(); updateTimerUI();
  
  let hintShown = false; 
  const lblHint = document.getElementById('lblQuizHint'); if(lblHint) lblHint.style.display = 'none';
  const speed = document.getElementById('selQuizSpeed') ? document.getElementById('selQuizSpeed').value : 'normal';
  const _timerStart = Date.now();
  const _timerBase = base;
  
  quizTimer = setInterval(() => {
    quizTimeLeft = Math.max(0, _timerBase - (Date.now() - _timerStart) / 1000);
    updateTimerUI();
    if (quizTimeLeft <= 0) {
      stopQuizTimer();
      evaluateRoundAnswer(false, "⏰ 時間切れ");
      return;
    }
    if (speed !== 'expert' && !hintShown && quizTimeLeft < (quizTimeLimit * (speed === 'easy' ? 0.7 : 0.4))) {
      hintShown = true; 
      const hb = document.getElementById('lblQuizHint');
      if (hb && cur.answer) {
          const ans1 = String(cur.answer).split(/[/|]/)[0].trim();
          hb.innerText = `ヒント: 先頭は「 ${ans1.charAt(0)} 」 ${ans1.length>3?`(全 ${ans1.length} 文字)`:''}`;
          hb.style.display = 'inline-block';
      }
    }
  }, 100);
}

function updateTimerUI() {
  const pct = (quizTimeLimit > 0) ? (quizTimeLeft/quizTimeLimit)*100 : 0;
  const bar = document.getElementById('barTimerFill'); 
  if (bar) {
      bar.style.width=`${pct}%`;
      bar.className = `timer-bar-fill ${pct<30?'warning':''}`;
  }
  const lblTimer = document.getElementById('lblQuizTimerText');
  if (lblTimer) lblTimer.innerText = `${Math.max(0, quizTimeLeft).toFixed(1)}s`;
}

// ★ タイマー安全停止（ここでエラーが起きないよう徹底防御）
function stopQuizTimer() {
  if (typeof quizTimer !== 'undefined' && quizTimer !== null) { 
    clearInterval(quizTimer); 
    quizTimer = null; 
  }
}

function getPrimaryAnswer(ans) { return ans ? String(ans).split(/[/|]/)[0].trim() : ''; }

function buildFourChoices(cur) {
  const area = document.getElementById('boxChoiceArea'); if(!area) return; area.innerHTML = '';
  const correctPrimary = getPrimaryAnswer(cur.answer);
  
  let altCandidates = [];
  if (typeof db !== 'undefined') {
      const catAnswers = db.filter(q => q.category === cur.category && getPrimaryAnswer(q.answer) !== correctPrimary).map(q => getPrimaryAnswer(q.answer));
      altCandidates = [...new Set(catAnswers)];
      if(altCandidates.length < 3) {
        const globalAnswers = db.filter(q => getPrimaryAnswer(q.answer) !== correctPrimary).map(q => getPrimaryAnswer(q.answer));
        altCandidates = [...new Set([...altCandidates, ...globalAnswers])];
      }
  }
  altCandidates.sort(() => Math.random() - 0.5);
  let finalFour = [correctPrimary, ...altCandidates.slice(0, 3)];
  while (finalFour.length < 4) finalFour.push(`選択肢_${Math.floor(Math.random()*1000)}`);
  finalFour.sort(() => Math.random() - 0.5);

  finalFour.forEach((text, i) => {
    const btn = document.createElement('button'); btn.className = 'choice-btn';
    btn.innerHTML = `<div class="choice-idx">${i+1}</div><div style="flex:1;">${typeof escapeHtml === 'function' ? escapeHtml(text) : text}</div>`;
    btn.onclick = () => {
      if(quizPhase !== 'q') return;
      document.querySelectorAll('.choice-btn').forEach(b => b.style.borderColor = 'var(--border)');
      btn.style.borderColor = 'var(--primary)'; selectedChoiceIdx = text;
    };
    area.appendChild(btn);
  });
}

var minhayaTarget = ""; var minhayaPos = 0;
function buildMinhayaMode(cur) { minhayaTarget = getPrimaryAnswer(cur.answer); minhayaPos = 0; renderMinhayaDisplay(cur); }
function renderMinhayaDisplay(cur) {
  const area = document.getElementById('boxMinhayaArea'); if(!area) return; area.innerHTML = '';
  let hintType = '';
  if(/^[ぁ-ん]+$/.test(minhayaTarget)) hintType = `【${minhayaTarget.length}文字】(ひらがなのみ)`;
  else if(/^[ァ-ヶ]+$/.test(minhayaTarget)) hintType = `【${minhayaTarget.length}文字】(カタカナのみ)`;
  else if(/^[a-zA-Z]+$/.test(minhayaTarget)) hintType = `【${minhayaTarget.length}文字】(アルファベット)`;
  else hintType = `【${minhayaTarget.length}文字】(漢字など含む)`;
  
  const hintDiv = document.createElement('div');
  hintDiv.style.cssText = 'text-align:center; font-size:0.75rem; color:var(--warn); margin-bottom:10px; font-weight:bold;';
  hintDiv.innerText = `💡 ヒント: ${hintType}`; area.appendChild(hintDiv);

  const slotsDiv = document.createElement('div');
  slotsDiv.style.cssText = 'display:flex; flex-wrap:wrap; justify-content:center; gap:6px; margin-bottom:18px;';
  for (let i = 0; i < minhayaTarget.length; i++) {
    const slot = document.createElement('div'); const filled = i < minhayaPos; const current = i === minhayaPos;
    slot.style.cssText = `min-width:42px; height:46px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.3rem; font-weight:bold; padding:0 6px; border:2px solid ${filled ? 'var(--success)' : current ? 'var(--primary)' : 'var(--border)'}; background:${filled ? 'rgba(34,199,122,0.12)' : current ? 'rgba(79,124,255,0.1)' : 'var(--bg3)'}; color:${filled ? 'var(--success)' : current ? 'var(--primary)' : 'var(--text3)'};`;
    slot.innerText = filled ? minhayaTarget[i] : (current ? '?' : '＿'); slotsDiv.appendChild(slot);
  }
  area.appendChild(slotsDiv);
  if (minhayaPos >= minhayaTarget.length) return;

  const correctChar = minhayaTarget[minhayaPos];
  let distChars = []; const targetChars = minhayaTarget.split('');
  if (typeof db !== 'undefined') {
      db.forEach(q => getPrimaryAnswer(q.answer).split('').forEach(c => { 
        if (!/[\s,、，。・/|]/.test(c) && !targetChars.includes(c)) distChars.push(c); 
      }));
  }
  distChars = [...new Set(distChars)].sort(() => Math.random() - 0.5);
  
  let choices = [correctChar];
  for (let c of distChars) { if (choices.length < 4 && !choices.includes(c)) choices.push(c); }
  const fallbacks = 'あいうえおかきくけこさしすせそ'.split('').sort(() => Math.random() - 0.5);
  for (let c of fallbacks) { if (choices.length < 4 && !targetChars.includes(c) && !choices.includes(c)) choices.push(c); }
  choices.sort(() => Math.random() - 0.5);

  const choicesDiv = document.createElement('div'); choicesDiv.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:10px;';
  choices.forEach(c => {
    const btn = document.createElement('button'); btn.className = 'choice-btn'; btn.style.cssText = 'justify-content:center; font-size:1.6rem; font-weight:bold; height:60px;'; btn.innerText = c;
    btn.onclick = () => {
      if (quizPhase !== 'q') return;
      if (c === correctChar) {
        minhayaPos++;
        if (minhayaPos >= minhayaTarget.length) { stopQuizTimer(); evaluateRoundAnswer(true, "🎉 正解！"); } else renderMinhayaDisplay(cur);
      } else {
        stopQuizTimer(); btn.style.background = 'rgba(255,79,106,0.3)'; btn.style.borderColor = 'var(--danger)';
        setTimeout(() => evaluateRoundAnswer(false, "❌ 不正解"), 300);
      }
    };
    choicesDiv.appendChild(btn);
  });
  area.appendChild(choicesDiv);
}

var currentTapTarget = ""; var currentTapInput = [];
function buildTapChoices(cur) {
  currentTapTarget = getPrimaryAnswer(cur.answer); currentTapInput = [];
  const inArea = document.getElementById('tapInputArea'); const chArea = document.getElementById('tapChoiceArea');
  if(!inArea || !chArea) return;
  inArea.innerHTML = ''; chArea.innerHTML = '';
  
  let chars = currentTapTarget.split('');
  let allChars = [];
  if (typeof db !== 'undefined') allChars = db.map(q => getPrimaryAnswer(q.answer)).join('').replace(/[、，／/ \u3000,\da-zA-Z|]/g, '').split('');
  if(allChars.length===0) allChars='あいうえおかきくけこ'.split('');
  for(let i=0;i<2;i++) chars.push(allChars[Math.floor(Math.random()*allChars.length)]);
  chars.sort(() => Math.random() - 0.5);
  
  chars.forEach((c, idx) => {
    const btn = document.createElement('button'); btn.className = 'btn btn-secondary'; btn.style.cssText = 'width:48px; height:48px; padding:0; font-size:1.3rem;'; btn.innerText = c; btn.id = 'tap_btn_' + idx;
    btn.onclick = () => {
      if (quizPhase !== 'q') return;
      currentTapInput.push({ char: c, id: btn.id }); btn.style.display = 'none'; renderTapInput();
      if (currentTapInput.length === currentTapTarget.length) {
        stopQuizTimer();
        const inputStr = currentTapInput.map(x => x.char).join('');
        evaluateRoundAnswer(inputStr === currentTapTarget, inputStr === currentTapTarget ? "🎉 正解！" : "❌ 不正解");
      }
    };
    chArea.appendChild(btn);
  });
}
function renderTapInput() {
  const inArea = document.getElementById('tapInputArea'); if(!inArea) return; inArea.innerHTML = '';
  if (currentTapInput.length === 0) { inArea.innerHTML = '<span style="color:var(--text3); font-size:0.85rem;">順番にタップしてください</span>'; return; }
  currentTapInput.forEach((item, index) => {
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--primary); color:#fff; width:36px; height:36px; border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:1.2rem; font-weight:bold; cursor:pointer;';
    box.innerText = item.char;
    box.onclick = (e) => {
      e.stopPropagation(); if (quizPhase !== 'q') return;
      const removed = currentTapInput.splice(index, 1)[0]; 
      const btn = document.getElementById(removed.id); if (btn) btn.style.display = 'inline-flex'; 
      renderTapInput();
    };
    inArea.appendChild(box);
  });
}

function buildSelfMode(cur) { 
    const b = document.getElementById('btnShowAnswer'); if(b) b.style.display = 'inline-flex'; 
    const a = document.getElementById('selfJudgeArea'); if(a) a.style.display = 'none'; 
}
function showSelfAnswer() {
  stopQuizTimer(); 
  const b = document.getElementById('btnShowAnswer'); if(b) b.style.display = 'none';
  const aDisplay = document.getElementById('selfAnswerDisplay');
  if(aDisplay && quizPool[quizIndex]) aDisplay.innerText = `A: ${getPrimaryAnswer(quizPool[quizIndex].answer)}`;
  const aArea = document.getElementById('selfJudgeArea'); if(aArea) aArea.style.display = 'block';
}
function submitSelfMode(judge) {
  window.currentSelfJudge = judge;
  evaluateRoundAnswer(judge !== 'miss', judge === 'perfect' ? "🎉 完璧！" : judge === 'good' ? "👍 普通" : "❌ ミス");
}

function passQuizQuestion() {
  if (quizPhase === 'a') return;
  stopQuizTimer();
  evaluateRoundAnswer(false, "🏳️ パスしました");
}

function submitQuizAction() {
  if (quizPhase === 'a') {
    if (typeof autoNextTimeout !== 'undefined' && autoNextTimeout) clearTimeout(autoNextTimeout); 
    quizIndex++;
    if(quizIndex < quizPool.length) {
      loadQuizQuestion();
    } else {
      lastQuizScopePath = [...selectedScopePath];
      if (window.currentOnlineMatch) {
          const lblQ = document.getElementById('lblQuizQuestion'); if(lblQ) lblQ.innerText = "対戦相手が終了するのを待っています...";
          const lblP = document.getElementById('lblQuizProgress'); if(lblP) lblP.innerText = "FIN";
          ['boxChoiceArea','boxDescArea','boxMinhayaArea','boxSelfArea', 'boxTapArea', 'btnQuizAction', 'btnQuizPass'].forEach(id => {
              const el = document.getElementById(id); if(el) el.style.display='none';
          });
          const fb = document.getElementById('quizFeedback'); if(fb) fb.style.display = 'none';

          if (typeof firestore !== 'undefined') {
              firestore.collection('susuru_anki_match_rooms').doc(window.currentOnlineMatch.roomId).update({
                  [window.currentOnlineMatch.myRole + '.finished']: true
              }).catch(()=>{});
          }
      } else {
          alert("🏁 クイズ終了！実績を確認しましょう。");
          if (typeof openPage === 'function') openPage('pgStats');
      }
    }
    return;
  }
  
  stopQuizTimer();
  const cur = quizPool[quizIndex]; 
  if (!cur) return;
  
  let isCorrect = false;
  const selMode = document.getElementById('selQuizMode');
  const mode = selMode ? selMode.value : 'normal';
  if (mode === 'choice') { 
      if(!selectedChoiceIdx) return; 
      isCorrect = isAnswerCorrect(selectedChoiceIdx, cur.answer); 
  } else { 
      const tDesc = document.getElementById('txtDescAnswer');
      isCorrect = isAnswerCorrect(tDesc ? tDesc.value : '', cur.answer); 
  }
  evaluateRoundAnswer(isCorrect, isCorrect ? "🎉 正解！" : "❌ 不正解");
}

// ★ データを処理する箇所を全て try-catch で囲み、万が一エラーが起きても必ずUI（正解）が表示されるようにする！
function evaluateRoundAnswer(isCorrect, head) {
  if (quizPhase === 'a') return; 
  quizPhase = 'a'; 
  stopQuizTimer(); 

  const cur = quizPool[quizIndex];
  if (!cur) return;

  const selMode = document.getElementById('selQuizMode');
  const currentMode = selMode ? selMode.value : 'normal';

  // ===== データ・Firebase更新処理（クラッシュ防止のため独立ブロック化） =====
  try {
      if(isCorrect) {
        currentCombo++; todayCorrectCount++; 
        if (typeof showComboAnim === 'function') showComboAnim(); 
        if (typeof recordDailyLog === 'function') recordDailyLog(true);
        
        if (window.currentOnlineMatch && typeof firestore !== 'undefined') {
          firestore.collection('susuru_anki_match_rooms').doc(window.currentOnlineMatch.roomId)
            .update({ [window.currentOnlineMatch.myRole + '.score']: firebase.firestore.FieldValue.increment(1) })
            .catch(e => console.warn("スコア送信エラー:", e));
        }
      } else {
        currentCombo = 0; 
        if (typeof recordDailyLog === 'function') recordDailyLog(false);
      }

      let m = typeof db !== 'undefined' ? db.find(q => q.id === cur.id) : null;
      if(m) {
        if(m.wrongStreak === undefined) m.wrongStreak = 0; 
        if(m.shikkariStreak === undefined) m.shikkariStreak = 0;
        
        const multiplier = (currentMode === 'choice' || currentMode === 'tap' || currentMode === 'minhaya') ? 2 : 1; 
        const th = currentQuestionGradThreshold || 5;

        if(isCorrect) {
          m.correct = (m.correct || 0) + 1; 
          if (typeof recordCategoryScore === 'function') recordCategoryScore(m.category, true);
          if (currentMode === 'self' && window.currentSelfJudge === 'good') m.wrongStreak = 0;
          else { m.streak = (m.streak || 0) + 1; m.wrongStreak = 0; }
          
          if (m.level === -1) {
            m.shikkariStreak++;
            if (m.shikkariStreak >= 5 * multiplier) { m.level = 0; m.shikkariStreak = 0; m.streak = 0; }
          } else if (m.correct - 1 >= th) {
          } else {
            if (m.streak >= 2 * multiplier && m.level < 5) { m.level++; m.streak = 0; }
          }
        } else {
          m.incorrect = (m.incorrect || 0) + 1; m.wrongStreak++; m.streak = 0; m.shikkariStreak = 0;
          if (typeof recordCategoryScore === 'function') recordCategoryScore(m.category, false);

          if (m.correct >= th) {
            if (m.wrongStreak >= 3 * multiplier) { m.correct = th - 1; m.level = 2; m.wrongStreak = 0; }
          } else {
            if (m.level !== -1) {
              if (m.wrongStreak >= 4 * multiplier) { m.level = -1; m.wrongStreak = 0; m.correct = 0; } 
              else if (m.wrongStreak > 0 && m.wrongStreak % (2 * multiplier) === 0 && m.level > 0) m.level--;
            }
          }
        }
        if (typeof saveData === 'function') saveData();
      }
  } catch (e) {
      console.warn("データ記録中にエラーが発生しましたが、処理を続行します。", e);
  }
  // =========================================================================

  // ★ ここから下は絶対に実行させる（UIの更新と自動進行）
  const fb = document.getElementById('quizFeedback');
  if (fb) {
      const fbResultText = document.getElementById('feedbackResultText');
      if (fbResultText) fbResultText.innerText = head;
      
      const fbAnswerText = document.getElementById('feedbackAnswerText');
      if (fbAnswerText) fbAnswerText.innerText = `正解: ${getPrimaryAnswer(cur.answer)}`;
      
      fb.className = `feedback-area ${isCorrect ? 'correct':'incorrect'}`; 
      fb.style.display = 'flex';
  }
  
  const btnPass = document.getElementById('btnQuizPass');
  if (btnPass) btnPass.style.display = 'none';
  
  const btnAction = document.getElementById('btnQuizAction');
  if (btnAction) {
      btnAction.style.display = 'inline-flex';
      btnAction.innerText = '次の問題へ';
  }

  if (['choice', 'tap', 'self', 'minhaya', 'desc'].includes(currentMode)) {
      if (typeof autoNextTimeout !== 'undefined' && autoNextTimeout) clearTimeout(autoNextTimeout);
      autoNextTimeout = setTimeout(() => {
          if (quizPhase === 'a') submitQuizAction();
      }, 3000);
  }
}

function showComboAnim() {
  if(currentCombo < 2) return;
  const cd = document.getElementById('comboDisplay'); if(!cd) return;
  cd.innerText = `${currentCombo} COMBO!`;
  cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop');
}

function saveQuickNote(val) {
  if (typeof db !== 'undefined' && quizPool[quizIndex]) {
      const m = db.find(q=>q.id === quizPool[quizIndex].id); 
      if(m) { m.note = val; if (typeof saveData === 'function') saveData(); }
  }
}

async function recordDailyLog(isCorrect) {
  if(typeof currentUser === 'undefined' || !currentUser) return;
  if(typeof firestore === 'undefined' || typeof firebase === 'undefined') return;
  
  const d = typeof getTodayStr === 'function' ? getTodayStr() : new Date().toISOString().split('T')[0]; 
  const lRef = firestore.collection('susuru_anki_logs').doc(`${d}_${currentUser.uid}`);
  const sRef = firestore.collection('susuru_anki_daily_scores').doc(`${d}_${currentUser.uid}`);
  try {
    await lRef.set({ date:d, uid:currentUser.uid, name:currentUser.displayName, answered:firebase.firestore.FieldValue.increment(1), correct:firebase.firestore.FieldValue.increment(isCorrect?1:0) }, {merge:true});
    if(isCorrect) await sRef.set({ date:d, uid:currentUser.uid, name:currentUser.displayName, score:firebase.firestore.FieldValue.increment(1) }, {merge:true});
  } catch(e){}
}
