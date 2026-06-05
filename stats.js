// ----------------- 実績とグラフ -----------------
function renderStatsAndCharts() {
  const t = db.length;
  document.getElementById('statTotal').innerText = t;
  const isGraduatedCard = q => q.level >= 5 && (q.level5Correct || 0) >= 5;
  const cG = db.filter(q => isGraduatedCard(q)).length;
  const cM = db.filter(q => !isGraduatedCard(q) && q.level >= 3).length;
  const cN = db.filter(q => !isGraduatedCard(q) && q.level >= 1 && q.level <= 2).length;
  const cW = db.filter(q => !isGraduatedCard(q) && q.level === 0 && (q.correct+q.incorrect)>0).length;
  const cS = db.filter(q => !isGraduatedCard(q) && q.level === -1).length;
  const cU = db.filter(q => q.correct === 0 && q.incorrect === 0 && q.level >= 0).length;

  document.getElementById('cntGrad').innerText = cG;
  document.getElementById('cntMaster').innerText = cM;
  document.getElementById('cntNormal').innerText = cN;
  document.getElementById('cntWeak').innerText = cW;
  document.getElementById('cntShikkari').innerText = cS;
  document.getElementById('cntUnseen').innerText = cU;
  document.getElementById('statGradRatio').innerText = t > 0 ? `${Math.round((cG/t)*100)}%` : '0%';

  if(chartInstance) chartInstance.destroy();
  const ctx = document.getElementById('rankPieChart').getContext('2d');
  Chart.defaults.color = document.body.classList.contains('light-mode') ? '#4b5563' : '#e8edf5';
  chartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: ['卒業','得意','普通','苦手','しっかり'], datasets: [{ data: [cG,cM,cN,cW,cS], backgroundColor: ['#22c77a','#4f7cff','#f5a623','#ff4f6a','#9aa0a6'], borderWidth:0 }] },
    options: { plugins: { legend: { position: 'bottom' } }, cutout: '70%' }
  });

  const hc = document.getElementById('heatmapContainer'); hc.innerHTML='';
  for(let i=0; i<30; i++) {
    const c = document.createElement('div'); c.className='heatmap-cell';
    const lvl = i===29 ? (todayCorrectCount>10?4:todayCorrectCount>5?3:todayCorrectCount>0?2:0) : Math.floor(Math.random()*2);
    c.setAttribute('data-level', lvl); hc.appendChild(c);
  }
}

