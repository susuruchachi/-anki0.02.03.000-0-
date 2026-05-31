// ----------------- クイズ機能 -----------------
function buildQuizScopeDropdown() {
  const container = document.getElementById('scopeSelectors'); if(!container) return;
  container.innerHTML = ''; createScopeSelect(0, getTopLevelCategories());
}
function createScopeSelect(depth, categoriesToShow) {
  if (categoriesToShow.length === 0) return;
  const select = document.createElement('select'); select.className = 'form-control';
  if (depth === 0) { const optAll = document.createElement('option'); optAll.value = "all"; optAll.innerText = "🌐 全てから出題"; select.appendChild(optAll); }
  const optDefault = document.createElement('option'); optDefault.value = ""; optDefault.innerText = depth === 0 ? "📁 トップカテゴリー..." : "📂 サブカテゴリー..."; optDefault.disabled = true; optDefault.selected = true; select.appendChild(optDefault);
  categoriesToShow.forEach(cat => { const opt = document.createElement('option'); opt.value = cat; opt.innerText = depth === 0 ? `📁 ${cat}` : `📂 ${cat}`; select.appendChild(opt); });
  select.onchange = (e) => {
    const val = e.target.value; const container = document.getElementById('scopeSelectors');
    const selects = Array.from(container.querySelectorAll('select')); selects.forEach((sel, idx) => { if (idx > depth) sel.remove(); });
    if (val === "all") { selectedScopePath = ["all"]; return; }
    selectedScopePath[depth] = val; selectedScopePath = selectedScopePath.slice(0, depth + 1);
    const children = categoryTree[val] || []; if (children.length > 0) createScopeSelect(depth + 1, children);
  };
  document.getElementById('scopeSelectors').appendChild(select);
}

// 正規化 (別解の / や | を考慮)
function normalizeAnswer(str) {
  if(!str) return '';
  let s = String(str).replace(/[Ａ-Ｚａ-ｚ０-９]/g, c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).toLowerCase().trim();
  s = s.replace(/擦/g, 'こす'); // 漢字揺れ対策
  // 別解対応: 最初の一つだけを正解のベースにする
  s = s.replace(/[、，＼＼ \u3000]+/g, ',');
  return s.split(',').map(x=>x.trim()).filter(x=>x!=='').sort().join(',');
}
function isAnswerCorrect(input, correctAnswer) {
  const norms = correctAnswer.split(/[/|]/).map(a => normalizeAnswer(a));
  const inNorm = normalizeAnswer(input);
  return norms.includes(inNorm);
}

function startQuiz(modeType = 'normal') {
  currentCombo = 0; todayCorrectCount = 0;
  // 前回のクイズ選択を復元
  if (lastQuizScopePath.length > 0) selectedScopePath = [...lastQuizScopePath];
  let scope = "all";
  if (selectedScopePath.length > 0 && selectedScopePath[0] !== "all") scope = "cat:" + selectedScopePath[selectedScopePath.length - 1];
  
  const includeGrad = document.getElementById('chkIncludeGrad').checked;
  const limitCount = parseInt(document.getElementById('numQCount').value) || 10;
  currentQuestionGradThreshold = parseInt(document.getElementById('numGradThreshold').value) || 5;

  let subset = [...db];
  
  if (modeType === 'tokkun') subset = subset.filter(q => q.level <= 0 || q.level === -1);
  else if (modeType === 'review') subset = subset.filter(q => q.correct >= currentQuestionGradThreshold);
  else if (!includeGrad) subset = subset.filter(q => q.correct < currentQuestionGradThreshold);

  if(scope.startsWith('cat:')) {
    const cName = scope.replace('cat:', '');
    const targets = getAllSubcategories(cName);
    subset = subset.filter(q => targets.includes(q.category));
  }

  if(subset.length === 0) return alert("⚠️ 条件に合致する問題が見つかりませんでした。");
  
  // ★ 優先順位付けロジック: 1.苦手 > 2.しっかり > 3.未着手 > 4.通常
  const prioritize = (q) => {
    if (q.level === 0 && (q.correct > 0 || q.incorrect > 0)) return 1;
    if (q.level === -1) return 2;
    if (q.correct === 0 && q.incorrect === 0) return 3;
    return 4;
  };

  // 一旦全体をランダムにシャッフル（同じ優先度の中で毎回出題をバラバラにするため）
  for (let i = subset.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [subset[i], subset[j]] = [subset[j], subset[i]]; }
  
  // その上で優先度順に並び替え
  subset.sort((a, b) => prioritize(a) - prioritize(b));

  quizPool = subset.slice(0, limitCount); quizIndex = 0;

  if (document.getElementById('chkSwapQA').checked) quizPool = quizPool.map(q => ({ ...q, question: q.answer, answer: q.question }));

  openPage('pgQuizPlayer'); loadQuizQuestion();
}

function loadQuizQuestion() {
  quizPhase='q'; selectedChoiceIdx=null; window.currentSelfJudge=null;
  const cur = quizPool[quizIndex];
  document.getElementById('lblQuizProgress').innerText = `Q ${quizIndex+1}/${quizPool.length}`;
  document.getElementById('lblQuizQuestion').innerText = cur.question;
  document.getElementById('quizFeedback').style.display = 'none';
  document.getElementById('txtQuickNote').value = cur.note || '';

  if(document.getElementById('chkTTS').checked) {
    window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(cur.question); u.lang='ja-JP'; window.speechSynthesis.speak(u);
  }

  const mode = document.getElementById('selQuizMode').value;
  ['boxChoiceArea','boxDescArea','boxMinhayaArea','boxSelfArea', 'boxTapArea'].forEach(id=>document.getElementById(id).style.display='none');
  document.getElementById('btnQuizAction').style.display='inline-flex'; document.getElementById('btnQuizPass').style.display='inline-flex';
  document.getElementById('btnQuizAction').innerText='確定する';

  if(mode==='choice') { document.getElementById('boxChoiceArea').style.display='grid'; buildFourChoices(cur); }
  else if(mode==='minhaya') { document.getElementById('boxMinhayaArea').style.display='block'; buildMinhayaMode(cur); document.getElementById('btnQuizAction').style.display='none'; }
  else if(mode==='tap') { document.getElementById('boxTapArea').style.display='block'; buildTapChoices(cur); document.getElementById('btnQuizAction').style.display='none'; }
  else if(mode==='self') { document.getElementById('boxSelfArea').style.display='block'; buildSelfMode(cur); document.getElementById('btnQuizAction').style.display='none'; document.getElementById('btnQuizPass').style.display='none'; }
  else { document.getElementById('boxDescArea').style.display='block'; document.getElementById('txtDescAnswer').value=''; document.getElementById('txtDescAnswer').disabled=false; document.getElementById('txtDescAnswer').focus(); }

  const speed = document.getElementById('selQuizSpeed').value;
  let base = 15; if(speed==='easy') base=25; else if(speed==='hard') base=10; else if(speed==='expert') base=5;
  if(cur.answer.length > 5) base += Math.min(15, (cur.answer.length - 5) * 1.5);
  if(document.getElementById('chkTimeAttack').checked) base *= 0.5;

  quizTimeLimit = base; quizTimeLeft = base;
  clearInterval(quizTimer); updateTimerUI();
  
  let hintShown = false; document.getElementById('lblQuizHint').style.display = 'none';
  quizTimer = setInterval(() => {
    quizTimeLeft -= 0.1; updateTimerUI();
    if(quizTimeLeft<=0) { clearInterval(quizTimer); evaluateRoundAnswer(false, "⏰ 時間切れ"); }
    if (speed !== 'expert' && !hintShown && quizTimeLeft < (quizTimeLimit * (speed === 'easy' ? 0.7 : 0.4))) {
      hintShown = true; const hb = document.getElementById('lblQuizHint');
      const ans1 = cur.answer.split(/[/|]/)[0].trim();
      hb.innerText = `ヒント: 先頭は「 ${ans1.charAt(0)} 」 ${ans1.length>3?`(全 ${ans1.length} 文字)`:''}`;
      hb.style.display = 'inline-block';
    }
  }, 100);
}

function updateTimerUI() {
  const pct = (quizTimeLeft/quizTimeLimit)*100;
  const bar = document.getElementById('barTimerFill'); bar.style.width=`${pct}%`;
  bar.className = `timer-bar-fill ${pct<30?'warning':''}`;
  document.getElementById('lblQuizTimerText').innerText = `${Math.max(0, quizTimeLeft).toFixed(1)}s`;
}

function getPrimaryAnswer(ans) { return ans.split(/[/|]/)[0].trim(); }

// 4択
function buildFourChoices(cur) {
  const area = document.getElementById('boxChoiceArea'); area.innerHTML = '';
  const correctPrimary = getPrimaryAnswer(cur.answer);
  
  let altCandidates = [];
  const catAnswers = db.filter(q => q.category === cur.category && getPrimaryAnswer(q.answer) !== correctPrimary).map(q => getPrimaryAnswer(q.answer));
  altCandidates = [...new Set(catAnswers)];
  if(altCandidates.length < 3) {
    const globalAnswers = db.filter(q => getPrimaryAnswer(q.answer) !== correctPrimary).map(q => getPrimaryAnswer(q.answer));
    altCandidates = [...new Set([...altCandidates, ...globalAnswers])];
  }
  altCandidates.sort(() => Math.random() - 0.5);
  let finalFour = [correctPrimary, ...altCandidates.slice(0, 3)];
  while (finalFour.length < 4) finalFour.push(`選択肢_${Math.floor(Math.random()*1000)}`);
  finalFour.sort(() => Math.random() - 0.5);

  finalFour.forEach((text, i) => {
    const btn = document.createElement('button'); btn.className = 'choice-btn';
    btn.innerHTML = `<div class="choice-idx">${i+1}</div><div style="flex:1;">${escapeHtml(text)}</div>`;
    btn.onclick = () => {
      if(quizPhase !== 'q') return;
      document.querySelectorAll('.choice-btn').forEach(b => b.style.borderColor = 'var(--border)');
      btn.style.borderColor = 'var(--primary)'; selectedChoiceIdx = text;
    };
    area.appendChild(btn);
  });
}

// みんはや
let minhayaTarget = ""; let minhayaPos = 0;
function buildMinhayaMode(cur) {
  minhayaTarget = getPrimaryAnswer(cur.answer); minhayaPos = 0; renderMinhayaDisplay(cur);
}
function renderMinhayaDisplay(cur) {
  const area = document.getElementById('boxMinhayaArea'); area.innerHTML = '';
  
  let hintType = '';
  if(/^[ぁ-ん]+$/.test(minhayaTarget)) hintType = `【${minhayaTarget.length}文字】(ひらがなのみ)`;
  else if(/^[ァ-ヶ]+$/.test(minhayaTarget)) hintType = `【${minhayaTarget.length}文字】(カタカナのみ)`;
  else if(/^[a-zA-Z]+$/.test(minhayaTarget)) hintType = `【${minhayaTarget.length}文字】(アルファベット)`;
  else hintType = `【${minhayaTarget.length}文字】(漢字など含む)`;
  
  const hintDiv = document.createElement('div');
  hintDiv.style.cssText = 'text-align:center; font-size:0.75rem; color:var(--warn); margin-bottom:10px; font-weight:bold;';
  hintDiv.innerText = `💡 ヒント: ${hintType}`;
  area.appendChild(hintDiv);

  const slotsDiv = document.createElement('div');
  slotsDiv.style.cssText = 'display:flex; flex-wrap:wrap; justify-content:center; gap:6px; margin-bottom:18px;';
  for (let i = 0; i < minhayaTarget.length; i++) {
    const slot = document.createElement('div'); const filled = i < minhayaPos; const current = i === minhayaPos;
    slot.style.cssText = `min-width:42px; height:46px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.3rem; font-weight:bold; padding:0 6px; border:2px solid ${filled ? 'var(--success)' : current ? 'var(--primary)' : 'var(--border)'}; background:${filled ? 'rgba(34,199,122,0.12)' : current ? 'rgba(79,124,255,0.1)' : 'var(--bg3)'}; color:${filled ? 'var(--success)' : current ? 'var(--primary)' : 'var(--text3)'};`;
    slot.innerText = filled ? minhayaTarget[i] : (current ? '?' : '＿');
    slotsDiv.appendChild(slot);
  }
  area.appendChild(slotsDiv);

  if (minhayaPos >= minhayaTarget.length) return;

  const correctChar = minhayaTarget[minhayaPos];
  let distChars = [];
  db.forEach(q => getPrimaryAnswer(q.answer).split('').forEach(c => { if (!/[\s,、，。・/|]/.test(c) && c !== correctChar) distChars.push(c); }));
  distChars = [...new Set(distChars)].sort(() => Math.random() - 0.5);
  
  let choices = [correctChar, ...distChars.slice(0, 3)];
  const fallbacks = 'あいうえおかきくけこさしすせそ'.split('').filter(c=>c!==correctChar);
  while(choices.length < 4) choices.push(fallbacks[Math.floor(Math.random()*fallbacks.length)]);
  choices.sort(() => Math.random() - 0.5);

  const choicesDiv = document.createElement('div'); choicesDiv.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:10px;';
  choices.forEach(c => {
    const btn = document.createElement('button'); btn.className = 'choice-btn'; btn.style.cssText = 'justify-content:center; font-size:1.6rem; font-weight:bold; height:60px;'; btn.innerText = c;
    btn.onclick = () => {
      if (quizPhase !== 'q') return;
      if (c === correctChar) {
        minhayaPos++;
        if (minhayaPos >= minhayaTarget.length) { clearInterval(quizTimer); evaluateRoundAnswer(true, "🎉 正解！"); } else renderMinhayaDisplay(cur);
      } else {
        clearInterval(quizTimer); btn.style.background = 'rgba(255,79,106,0.3)'; btn.style.borderColor = 'var(--danger)';
        setTimeout(() => evaluateRoundAnswer(false, "❌ 不正解"), 300);
      }
    };
    choicesDiv.appendChild(btn);
  });
  area.appendChild(choicesDiv);
}

// タップ
let currentTapTarget = ""; let currentTapInput = [];
function buildTapChoices(cur) {
  currentTapTarget = getPrimaryAnswer(cur.answer); currentTapInput = [];
  const inArea = document.getElementById('tapInputArea'); const chArea = document.getElementById('tapChoiceArea');
  inArea.innerHTML = ''; chArea.innerHTML = '';
  
  let chars = currentTapTarget.split('');
  let allChars = db.map(q => getPrimaryAnswer(q.answer)).join('').replace(/[、，／/ \u3000,\da-zA-Z|]/g, '').split('');
  if(allChars.length===0) allChars='あいうえおかきくけこ'.split('');
  for(let i=0;i<2;i++) chars.push(allChars[Math.floor(Math.random()*allChars.length)]);
  chars.sort(() => Math.random() - 0.5);
  
  chars.forEach((c, idx) => {
    const btn = document.createElement('button'); btn.className = 'btn btn-secondary'; btn.style.cssText = 'width:48px; height:48px; padding:0; font-size:1.3rem;'; btn.innerText = c; btn.id = 'tap_btn_' + idx;
    btn.onclick = () => {
      if (quizPhase !== 'q') return;
      currentTapInput.push({ char: c, id: btn.id }); btn.style.display = 'none'; renderTapInput();
      if (currentTapInput.length === currentTapTarget.length) {
        clearInterval(quizTimer);
        const inputStr = currentTapInput.map(x => x.char).join('');
        evaluateRoundAnswer(inputStr === currentTapTarget, inputStr === currentTapTarget ? "🎉 正解！" : "❌ 不正解");
      }
    };
    chArea.appendChild(btn);
  });
}
function renderTapInput() {
  const inArea = document.getElementById('tapInputArea'); inArea.innerHTML = '';
  if (currentTapInput.length === 0) { inArea.innerHTML = '<span style="color:var(--text3); font-size:0.85rem;">順番にタップしてください</span>'; return; }
  currentTapInput.forEach((item, index) => {
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--primary); color:#fff; width:36px; height:36px; border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:1.2rem; font-weight:bold; cursor:pointer;';
    box.innerText = item.char;
    box.onclick = (e) => {
      e.stopPropagation(); if (quizPhase !== 'q') return;
      const removed = currentTapInput.splice(index, 1)[0]; document.getElementById(removed.id).style.display = 'inline-flex'; renderTapInput();
    };
    inArea.appendChild(box);
  });
}

// 自己申告
function buildSelfMode(cur) { document.getElementById('btnShowAnswer').style.display = 'inline-flex'; document.getElementById('selfJudgeArea').style.display = 'none'; }
function showSelfAnswer() {
  clearInterval(quizTimer); document.getElementById('btnShowAnswer').style.display = 'none';
  document.getElementById('selfAnswerDisplay').innerText = `A: ${getPrimaryAnswer(quizPool[quizIndex].answer)}`;
  document.getElementById('selfJudgeArea').style.display = 'block';
}
function submitSelfMode(judge) {
  window.currentSelfJudge = judge;
  evaluateRoundAnswer(judge !== 'miss', judge === 'perfect' ? "🎉 完璧！" : judge === 'good' ? "👍 普通" : "❌ ミス");
}

function passQuizQuestion() { clearInterval(quizTimer); evaluateRoundAnswer(false, "🏳️ パスしました"); }

function submitQuizAction() {
  if (quizPhase === 'a') {
    clearTimeout(autoNextTimeout); quizIndex++;
    if(quizIndex < quizPool.length) loadQuizQuestion();
    else { lastQuizScopePath = [...selectedScopePath]; alert("🏁 クイズ終了！実績を確認しましょう。"); openPage('pgStats'); }
    return;
  }
  clearInterval(quizTimer);
  const cur = quizPool[quizIndex]; let isCorrect = false;
  const mode = document.getElementById('selQuizMode').value;
  if (mode === 'choice') { if(!selectedChoiceIdx) return; isCorrect = isAnswerCorrect(selectedChoiceIdx, cur.answer); } 
  else { isCorrect = isAnswerCorrect(document.getElementById('txtDescAnswer').value, cur.answer); }
  evaluateRoundAnswer(isCorrect, isCorrect ? "🎉 正解！" : "❌ 不正解");
}

function evaluateRoundAnswer(isCorrect, head) {
  quizPhase = 'a'; const cur = quizPool[quizIndex];
  let m = db.find(q => q.id === cur.id);
  
  if(m) {
    if(m.wrongStreak === undefined) m.wrongStreak = 0; if(m.shikkariStreak === undefined) m.shikkariStreak = 0;
    const mode = document.getElementById('selQuizMode').value;
    const multiplier = (mode === 'choice' || mode === 'tap' || mode === 'minhaya') ? 2 : 1; 
    const th = currentQuestionGradThreshold;

    if(isCorrect) {
      m.correct++; currentCombo++; todayCorrectCount++; showComboAnim(); recordDailyLog(true); recordCategoryScore(m.category, true);
      if (mode === 'self' && window.currentSelfJudge === 'good') m.wrongStreak = 0;
      else { m.streak++; m.wrongStreak = 0; }
      
      if (m.level === -1) {
        m.shikkariStreak++;
        if (m.shikkariStreak >= 5 * multiplier) { m.level = 0; m.shikkariStreak = 0; m.streak = 0; }
      } else if (m.correct - 1 >= th) {
      } else {
        if (m.streak >= 2 * multiplier && m.level < 5) { m.level++; m.streak = 0; }
      }
    } else {
      m.incorrect++; m.wrongStreak++; m.streak = 0; m.shikkariStreak = 0;
      currentCombo = 0; recordDailyLog(false); recordCategoryScore(m.category, false);

      if (m.correct >= th) {
        if (m.wrongStreak >= 3 * multiplier) { m.correct = th - 1; m.level = 2; m.wrongStreak = 0; }
      } else {
        if (m.level !== -1) {
          if (m.wrongStreak >= 4 * multiplier) { m.level = -1; m.wrongStreak = 0; m.correct = 0; } 
          else if (m.wrongStreak > 0 && m.wrongStreak % (2 * multiplier) === 0 && m.level > 0) m.level--;
        }
      }
    }
    saveData();
  }
  
  const fb = document.getElementById('quizFeedback');
  document.getElementById('feedbackResultText').innerText = head;
  document.getElementById('feedbackAnswerText').innerText = `正解: ${getPrimaryAnswer(cur.answer)}`;
  fb.className = `feedback-area ${isCorrect ? 'correct':'incorrect'}`; fb.style.display = 'flex';
  
  document.getElementById('btnQuizPass').style.display = 'none';
  document.getElementById('btnQuizAction').style.display = 'inline-flex';
  document.getElementById('btnQuizAction').innerText = '次の問題へ';

  const mode = document.getElementById('selQuizMode').value;
  if (['choice', 'tap', 'self', 'minhaya'].includes(mode)) {
    clearTimeout(autoNextTimeout); autoNextTimeout = setTimeout(() => { if (quizPhase === 'a') submitQuizAction(); }, 3000);
  }
}

function showComboAnim() {
  if(currentCombo < 2) return;
  const cd = document.getElementById('comboDisplay'); cd.innerText = `${currentCombo} COMBO!`;
  cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop');
}

function saveQuickNote(val) {
  const m = db.find(q=>q.id === quizPool[quizIndex].id); if(m) { m.note = val; saveData(); }
}

async function recordDailyLog(isCorrect) {
  if(!currentUser) return;
  const d = getTodayStr(); 
  const lRef = firestore.collection('susuru_anki_logs').doc(`${d}_${currentUser.uid}`);
  const sRef = firestore.collection('susuru_anki_daily_scores').doc(`${d}_${currentUser.uid}`);
  try {
    await lRef.set({ date:d, uid:currentUser.uid, name:currentUser.displayName, answered:firebase.firestore.FieldValue.increment(1), correct:firebase.firestore.FieldValue.increment(isCorrect?1:0) }, {merge:true});
    if(isCorrect) await sRef.set({ date:d, uid:currentUser.uid, name:currentUser.displayName, score:firebase.firestore.FieldValue.increment(1) }, {merge:true});
  } catch(e){}
}