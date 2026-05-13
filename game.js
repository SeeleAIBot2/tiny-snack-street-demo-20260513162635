(() => {
  const STORAGE_KEY = 'tiny-snack-street-save-v1';
  const customerFaces = ['🧒', '👧', '👨', '👩', '🧑', '👴', '👵', '🧔'];
  const menu = [
    { id: 'riceball', name: '芝士饭团', emoji: '🍙', unlockOrders: 0, baseReward: 8 },
    { id: 'lemon', name: '柠檬气泡水', emoji: '🥤', unlockOrders: 3, baseReward: 13 },
    { id: 'taco', name: '彩虹卷饼', emoji: '🌮', unlockOrders: 8, baseReward: 22 },
    { id: 'waffle', name: '星星华夫', emoji: '🧇', unlockOrders: 15, baseReward: 34 }
  ];

  const defaultState = {
    coins: 30,
    ordersServed: 0,
    speedLevel: 1,
    profitLevel: 1,
    helperLevel: 0,
    stallLevel: 1,
    nextDouble: false,
    lastSeen: Date.now(),
    // === New WeChat Mini Game State ===
    signInDays: 0,
    lastSignInDate: null,
    doubleIncomeEnd: 0,
    tasks: [
      { id: 'daily1', name: '完成5单', target: 5, progress: 0, reward: 80, claimed: false },
      { id: 'daily2', name: '赚200金币', target: 200, progress: 0, reward: 120, claimed: false },
      { id: 'daily3', name: '升级一次摊位', target: 1, progress: 0, reward: 180, claimed: false }
    ],
    achievements: []
  };

  let state = loadState();
  let queue = [];
  let currentOrder = null;
  let isCooking = false;
  let cooked = false;
  let cookStartedAt = 0;
  let cookDuration = 2400;
  let toastTimer = null;
  let saveTimer = null;

  const $ = (id) => document.getElementById(id);
  const els = {
    coins: $('coins'), featuredItem: $('featuredItem'), offlinePanel: $('offlinePanel'), offlineText: $('offlineText'),
    claimOfflineBtn: $('claimOfflineBtn'), queue: $('queue'), currentDish: $('currentDish'), cookProgress: $('cookProgress'),
    orderHint: $('orderHint'), orderName: $('orderName'), orderReward: $('orderReward'), cookBtn: $('cookBtn'),
    serveBtn: $('serveBtn'), doubleBtn: $('doubleBtn'), rushBtn: $('rushBtn'), upgrades: $('upgrades'), resetBtn: $('resetBtn'),
    toast: $('toast'), popLayer: $('popLayer'), questText: $('questText'),
    // === New WeChat Mini Game Elements ===
    taskList: $('taskList'), signInBadge: $('signInBadge'), shareBtn: $('shareBtn'), rankBtn: $('rankBtn'),
    inviteBtn: $('inviteBtn'), modalOverlay: $('modalOverlay'), adModal: $('adModal'), adRewardText: $('adRewardText'),
    adProgressFill: document.querySelector('.ad-progress-fill'), adWatchBtn: $('adWatchBtn'), adCancelBtn: $('adCancelBtn'),
    shareModal: $('shareModal'), shareConfirmBtn: $('shareConfirmBtn'), shareCancelBtn: $('shareCancelBtn'),
    signInModal: $('signInModal'), signInGrid: $('signInGrid'), signInClaimBtn: $('signInClaimBtn'), signInCancelBtn: $('signInCancelBtn')
  };

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return { ...defaultState, ...(saved || {}) };
    } catch (_) {
      return { ...defaultState };
    }
  }

  function saveState() {
    state.lastSeen = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 120);
  }

  function fmt(n) { return Math.floor(n).toLocaleString('zh-CN'); }

  function renderCoins() {
    els.coins.textContent = fmt(state.coins);
  }

  function unlockedMenu() {
    return menu.filter(item => state.ordersServed >= item.unlockOrders).slice(0, Math.min(menu.length, state.stallLevel + 1));
  }

  function randomMenuItem() {
    const list = unlockedMenu();
    return list[Math.floor(Math.random() * list.length)] || menu[0];
  }

  function getCookDuration() {
    const speed = 1 + (state.speedLevel - 1) * 0.28 + state.helperLevel * 0.08;
    return Math.max(650, Math.round(2600 / speed));
  }

  function upgradeCost(type) {
    const costs = {
      speed: 38 * Math.pow(1.72, state.speedLevel - 1),
      profit: 46 * Math.pow(1.78, state.profitLevel - 1),
      helper: 90 * Math.pow(2.08, state.helperLevel),
      stall: 130 * Math.pow(2.18, state.stallLevel - 1)
    };
    return Math.round(costs[type]);
  }

  function upgradeMax(type) {
    return ({ speed: 8, profit: 8, helper: 4, stall: 3 })[type];
  }

  function makeCustomer() {
    const item = randomMenuItem();
    return { id: `${Date.now()}-${Math.random()}`, face: customerFaces[Math.floor(Math.random() * customerFaces.length)], item };
  }

  function fillQueue() {
    const target = Math.min(4, 2 + state.stallLevel);
    while (queue.length < target) queue.push(makeCustomer());
    if (!currentOrder && queue.length) currentOrder = queue[0];
  }

  function renderQueue() {
    els.queue.innerHTML = '';
    queue.forEach((customer, idx) => {
      const card = document.createElement('div');
      card.className = 'customer';
      card.innerHTML = `<div class="bubble">${customer.item.emoji} ${idx === 0 ? '我先!' : ''}</div><div class="avatar">${customer.face}</div>`;
      els.queue.appendChild(card);
    });
  }

  function renderOrder() {
    if (!currentOrder) {
      els.orderName.textContent = '等待顾客...';
      els.orderReward.textContent = '0';
      els.currentDish.textContent = '🍽️';
      els.orderHint.textContent = '顾客马上就到';
      return;
    }
    const reward = rewardFor(currentOrder.item) * (state.nextDouble ? 2 : 1);
    els.orderName.textContent = `${currentOrder.item.emoji} ${currentOrder.item.name}`;
    els.orderReward.textContent = fmt(reward);
    els.currentDish.textContent = currentOrder.item.emoji;
    els.featuredItem.textContent = unlockedMenu().at(-1)?.name || '芝士饭团';
    if (!isCooking && !cooked) els.orderHint.textContent = `预计 ${Math.ceil(getCookDuration() / 1000)} 秒完成，点按钮开始制作`;
  }

  function renderUpgrades() {
    const data = [
      { type: 'speed', icon: '🔥', title: '加热台', level: state.speedLevel, desc: '缩短制作时间' },
      { type: 'profit', icon: '💰', title: '招牌套餐', level: state.profitLevel, desc: '每单收入提高' },
      { type: 'helper', icon: '🤖', title: '小助手', level: state.helperLevel, desc: '自动制作并产生离线收益' },
      { type: 'stall', icon: '🏪', title: '新摊位', level: state.stallLevel, desc: '增加队列并解锁更多商品' }
    ];

    els.upgrades.innerHTML = '';
    data.forEach(u => {
      const max = upgradeMax(u.type);
      const atMax = u.level >= max;
      const cost = upgradeCost(u.type);
      const row = document.createElement('div');
      row.className = 'upgrade';
      row.innerHTML = `
        <div class="icon">${u.icon}</div>
        <div><h3>${u.title} Lv.${u.level}${u.type === 'helper' && u.level === 0 ? '（未雇佣）' : ''}</h3><p>${u.desc}${atMax ? ' · 已满级' : ''}</p></div>
        <button class="buy-btn ${atMax ? 'max' : ''}" data-type="${u.type}" ${atMax ? 'disabled' : ''}>${atMax ? 'MAX' : `🪙${fmt(cost)}`}</button>`;
      els.upgrades.appendChild(row);
    });
  }

  function renderQuest() {
    let text = '完成 3 单后解锁柠檬气泡水，雇佣助手会自动接单赚钱。';
    if (state.ordersServed >= 3 && state.ordersServed < 8) text = '已解锁柠檬气泡水！继续到 8 单解锁彩虹卷饼。';
    if (state.ordersServed >= 8 && state.ordersServed < 15) text = '彩虹卷饼上线。升级新摊位，准备解锁星星华夫。';
    if (state.ordersServed >= 15) text = '完整循环已跑通：继续堆升级，冲刺更高离线收益。';
    els.questText.textContent = text;
  }

  function renderAll() {
    fillQueue();
    renderCoins();
    renderQueue();
    renderOrder();
    renderUpgrades();
    renderQuest();
    renderTasks();
    checkSignIn();
    els.cookBtn.disabled = isCooking || cooked || !currentOrder;
    els.serveBtn.disabled = !cooked;
    els.doubleBtn.textContent = state.nextDouble ? '✅ 下一单已双倍' : '📺 双倍下一单';
  }

  function toast(text) {
    clearTimeout(toastTimer);
    els.toast.textContent = text;
    els.toast.classList.remove('hidden');
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 1800);
  }

  function popCoins(amount) {
    const pop = document.createElement('div');
    pop.className = 'coin-pop';
    pop.textContent = `+${fmt(amount)} 🪙`;
    pop.style.left = `${44 + Math.random() * 18}%`;
    els.popLayer.appendChild(pop);
    setTimeout(() => pop.remove(), 1000);
  }

  function startCooking(auto = false) {
    if (!currentOrder || isCooking || cooked) return;
    isCooking = true;
    cookStartedAt = performance.now();
    cookDuration = getCookDuration();
    els.currentDish.classList.add('cooking');
    els.orderHint.textContent = auto ? '助手正在制作...' : '制作中，进度满后点击收银';
    els.cookBtn.disabled = true;
    requestAnimationFrame(tickCooking);
  }

  function tickCooking(now) {
    if (!isCooking) return;
    const pct = Math.min(1, (now - cookStartedAt) / cookDuration);
    els.cookProgress.style.width = `${pct * 100}%`;
    if (pct >= 1) {
      isCooking = false;
      cooked = true;
      els.currentDish.classList.remove('cooking');
      els.orderHint.textContent = '做好了！点击收银完成订单';
      renderAll();
      return;
    }
    requestAnimationFrame(tickCooking);
  }

  function serveOrder(auto = false) {
    if (!currentOrder || !cooked) return;
    const base = rewardFor(currentOrder.item);
    const reward = base * (state.nextDouble ? 2 : 1);
    state.coins += reward;
    state.ordersServed += 1;
    updateTaskProgress('daily1', 1);
    updateTaskProgress('daily2', reward);
    state.nextDouble = false;
    queue.shift();
    currentOrder = queue[0] || null;
    cooked = false;
    isCooking = false;
    els.cookProgress.style.width = '0%';
    popCoins(reward);
    if (!auto) toast(`卖出 ${state.ordersServed} 单，收入 +${fmt(reward)}`);
    scheduleSave();
    renderAll();
  }

  function buyUpgrade(type) {
    const key = `${type}Level`;
    if (type === 'stall') key;
    const levelKey = type === 'speed' ? 'speedLevel' : type === 'profit' ? 'profitLevel' : type === 'helper' ? 'helperLevel' : 'stallLevel';
    if (state[levelKey] >= upgradeMax(type)) return;
    const cost = upgradeCost(type);
    if (state.coins < cost) {
      toast(`金币不够，还差 ${fmt(cost - state.coins)}`);
      return;
    }
    state.coins -= cost;
    state[levelKey] += 1;
    updateTaskProgress('daily3', 1);
    toast(type === 'helper' ? '助手上岗：会自动制作订单' : '升级成功，效率提升');
    scheduleSave();
    renderAll();
  }

  function fakeAdDouble() {
    state.nextDouble = true;
    toast('广告占位：已模拟看完，下一单收益 x2');
    scheduleSave();
    renderAll();
  }

  function fakeAdRush() {
    if (!currentOrder) return toast('暂无订单可加速');
    if (!isCooking && !cooked) startCooking();
    if (isCooking) {
      isCooking = false;
      cooked = true;
      els.cookProgress.style.width = '100%';
      els.currentDish.classList.remove('cooking');
      toast('广告占位：快速制作完成');
      renderAll();
    } else if (cooked) {
      toast('已经做好了，快去收银');
    }
  }

  // === New WeChat Mini Game Core Functions ===
  function getTodayDateStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function checkSignIn() {
    const today = getTodayDateStr();
    const signedInToday = state.lastSignInDate === today;
    els.signInBadge.classList.remove('hidden');
    els.signInBadge.textContent = signedInToday ? '✅ 已签到' : '📅 待签到';
    // 首屏不自动弹签到，避免遮挡主流程；玩家点击“待签到”手动领取。
  }

  function openSignInModal() {
    els.modalOverlay.classList.remove('hidden');
    els.signInModal.classList.remove('hidden');
    renderSignInGrid();
  }

  function renderSignInGrid() {
    const rewards = [10,30,50,80,120,200,500];
    const today = getTodayDateStr();
    const signedInToday = state.lastSignInDate === today;
    let html = '';
    for (let i=0; i<7; i++) {
      const day = i+1;
      const claimed = i < state.signInDays || (i === state.signInDays && signedInToday);
      const isToday = i === state.signInDays;
      html += `<div class="sign-in-day ${claimed ? 'claimed' : ''} ${isToday ? 'today' : ''}">
        <div>${claimed ? '✅' : '🗓️'}</div>
        <div>第${day}天</div>
        <div>💰 ${rewards[i]}</div>
      </div>`;
    }
    els.signInGrid.innerHTML = html;
    els.signInClaimBtn.disabled = signedInToday;
    els.signInClaimBtn.textContent = signedInToday ? '今日已领取' : '领取今日奖励';
  }

  function claimSignIn() {
    const today = getTodayDateStr();
    if (state.lastSignInDate === today) return toast('今日已签到');
    const rewards = [10,30,50,80,120,200,500];
    const reward = rewards[state.signInDays];
    state.coins += reward;
    state.signInDays = (state.signInDays + 1) % 7;
    state.lastSignInDate = today;
    toast(`签到成功！获得 ${reward} 金币`);
    checkSignIn();
    renderSignInGrid();
    scheduleSave();
  }

  function renderTasks() {
    let html = '';
    state.tasks.forEach(task => {
      const completed = task.progress >= task.target;
      html += `<div class="task-item ${completed ? 'completed' : ''}" data-id="${task.id}">
        <div>
          <h4>${task.name}</h4>
          <p>奖励 ${task.reward} 金币</p>
        </div>
        <div style="display: flex; align-items: center;">
          <span class="task-progress">${task.progress}/${task.target}</span>
          <button class="task-claim-btn ${completed && !task.claimed ? '' : 'claimed'}" ${!completed || task.claimed ? 'disabled' : ''}>
            ${task.claimed ? '已领取' : completed ? '领取' : '进行中'}
          </button>
        </div>
      </div>`;
    });
    els.taskList.innerHTML = html;
  }

  function updateTaskProgress(taskId, add = 1) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task || task.claimed) return;
    task.progress = Math.min(task.target, task.progress + add);
    scheduleSave();
    renderTasks();
  }

  function claimTask(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task || task.claimed || task.progress < task.target) return;
    task.claimed = true;
    state.coins += task.reward;
    toast(`任务完成！获得 ${task.reward} 金币`);
    scheduleSave();
    renderTasks();
  }

  // === Ad System (Natural Triggered) ===
  let currentAdReward = () => {};
  function openAdModal(rewardText, onReward) {
    els.adRewardText.textContent = rewardText;
    els.adProgressFill.style.width = '0%';
    currentAdReward = onReward;
    els.modalOverlay.classList.remove('hidden');
    els.adModal.classList.remove('hidden');
  }

  function simulateAdWatch() {
    els.adWatchBtn.disabled = true;
    els.adWatchBtn.textContent = '播放中...';
    let progress = 0;
    const timer = setInterval(() => {
      progress += 10;
      els.adProgressFill.style.width = `${progress}%`;
      if (progress >= 100) {
        clearInterval(timer);
        closeModals();
        currentAdReward?.();
        toast('广告观看完成，奖励已到账');
        els.adWatchBtn.disabled = false;
        els.adWatchBtn.textContent = '观看广告';
      }
    }, 300);
  }

  // === Share System (WeChat Hooks) ===
  function openShareModal() {
    els.modalOverlay.classList.remove('hidden');
    els.shareModal.classList.remove('hidden');
  }

  function doShare() {
    closeModals();
    state.coins += 500;
    state.doubleIncomeEnd = Date.now() + 3600 * 1000;
    toast('分享成功！获得500金币+1小时双倍收益');
    scheduleSave();
    // 真实微信小游戏环境下调用 wx.shareAppMessage()
  }

  function closeModals() {
    els.modalOverlay.classList.add('hidden');
    els.adModal.classList.add('hidden');
    els.shareModal.classList.add('hidden');
    els.signInModal.classList.add('hidden');
  }

  // === Enhanced Core Functions ===
  function applyOfflineIncome() {
    const now = Date.now();
    const awayMs = Math.max(0, now - (state.lastSeen || now));
    if (state.helperLevel <= 0 || awayMs < 30_000) return;
    const minutes = Math.min(180, awayMs / 60000);
    const avgReward = rewardFor(unlockedMenu()[0] || menu[0]);
    const income = Math.floor(minutes * state.helperLevel * avgReward * 0.55);
    if (income <= 0) return;
    els.offlineText.textContent = `助手帮你赚了 ${fmt(income)} 金币（最多统计 3 小时）`;
    els.offlinePanel.classList.remove('hidden');
    // 广告翻倍选项
    const doubleBtn = document.createElement('button');
    doubleBtn.className = 'mini-btn';
    doubleBtn.textContent = '📺 广告翻倍';
    doubleBtn.addEventListener('click', () => {
      openAdModal('观看广告即可获得双倍离线收益', () => {
        state.coins += income * 2;
        toast(`翻倍成功！获得 ${fmt(income*2)} 金币`);
      });
    });
    els.offlinePanel.appendChild(doubleBtn);
    els.claimOfflineBtn.addEventListener('click', () => {
      state.coins += income;
      scheduleSave();
    }, { once: true });
  }

  function rewardFor(item) {
    const profit = 1 + (state.profitLevel - 1) * 0.32;
    const stall = 1 + (state.stallLevel - 1) * 0.16;
    const double = Date.now() < state.doubleIncomeEnd ? 2 : 1;
    return Math.round(item.baseReward * profit * stall * double);
  }

  function helperLoop() {
    if (state.helperLevel > 0 && !isCooking && !cooked && currentOrder) {
      const chance = 0.28 + state.helperLevel * 0.12;
      if (Math.random() < chance) startCooking(true);
    } else if (state.helperLevel > 1 && cooked) {
      serveOrder(true);
    }
  }

  els.cookBtn.addEventListener('click', () => startCooking(false));
  els.serveBtn.addEventListener('click', () => serveOrder(false));
  els.doubleBtn.addEventListener('click', fakeAdDouble);
  els.rushBtn.addEventListener('click', fakeAdRush);
  els.claimOfflineBtn.addEventListener('click', () => els.offlinePanel.classList.add('hidden'));
  els.upgrades.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-type]');
    if (btn) buyUpgrade(btn.dataset.type);
  });
  els.resetBtn.addEventListener('click', () => {
    if (!confirm('确定清空本地存档并重新开店吗？')) return;
    localStorage.removeItem(STORAGE_KEY);
    state = { ...defaultState, lastSeen: Date.now() };
    queue = [];
    currentOrder = null;
    isCooking = false;
    cooked = false;
    els.cookProgress.style.width = '0%';
    toast('已重置，重新开张！');
    renderAll();
    saveState();
  });

  // === New WeChat Mini Game Event Bindings ===
  els.taskList.addEventListener('click', (e) => {
    const item = e.target.closest('.task-item');
    if (item) {
      const id = item.dataset.id;
      const claimBtn = item.querySelector('.task-claim-btn');
      if (claimBtn && !claimBtn.disabled) {
        claimTask(id);
      }
    }
  });

  els.signInBadge.addEventListener('click', openSignInModal);
  els.shareBtn.addEventListener('click', openShareModal);
  els.rankBtn.addEventListener('click', () => toast('排行榜功能开发中，即将上线'));
  els.inviteBtn.addEventListener('click', () => openAdModal('邀请好友即可获得500金币奖励', () => {
    state.coins += 500;
    toast('邀请成功！获得500金币');
  }));

  // Modal events
  els.modalOverlay.addEventListener('click', closeModals);
  els.adCancelBtn.addEventListener('click', closeModals);
  els.adWatchBtn.addEventListener('click', simulateAdWatch);
  els.shareCancelBtn.addEventListener('click', closeModals);
  els.shareConfirmBtn.addEventListener('click', doShare);
  els.signInCancelBtn.addEventListener('click', closeModals);
  els.signInClaimBtn.addEventListener('click', claimSignIn);

  window.addEventListener('beforeunload', saveState);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveState(); });

  applyOfflineIncome();
  renderAll();
  setInterval(() => { fillQueue(); renderAll(); }, 5500);
  setInterval(helperLoop, 2800);
})();
