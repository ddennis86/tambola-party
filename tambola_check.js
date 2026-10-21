
  "use strict";

// =====================================
// SUPABASE CONFIGURATION
// =====================================

const SUPABASE_URL =
  "https://prdgeodluuiylzrywdxm.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_W0xi00YmUDEpF8j38xs7kw_PVRCgRjy";

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

// =====================================
// GLOBAL VARIABLES
// =====================================

let game = null;
let player = null;
let tickets = [];

let hostToken = null;
let playerToken = null;

let coAdminToken = null;
let coAdminName = null;

let winners = [];
let players = [];
let marked = {};

let realtimeChannel = null;
let refreshTimer = null;
let countdownTimer = null;

let currentView = "home";

let initialWinnersLoaded = false;
let lastWinnerIds = new Set();

let refreshing = false;
let refreshAgain = false;
let switchingGame = false;
let callingNumber = false;

let claimingPrizes = new Set();

let winnerPopupTimer = null;
let winnerPopupQueue = [];
let winnerPopupActive = false;

let numberCallHistory = [];
let serverTimeOffset = 0;

const PLAYER_SOUND_KEY = "tambola_player_sound";
let playerSoundEnabled =
  localStorage.getItem(PLAYER_SOUND_KEY) === "true";
let playerSoundReady = false;
let playerNumberAnnouncements = {
  gameId: null,
  observed: new Set()
};

let adminValidationInProgress = false;
let lastAdminValidation = 0;

const SESSION_KEY = "tambola_session";

const CO_ADMIN_SESSION_KEY =
  "tambola_co_admin_session";

const prizes = [
  "Early 5",
  "Early 7",
  "Any Line",
  "Top Line",
  "Middle Line",
  "Bottom Line",
  "Four Corners",
  "Full House"
];

// =====================================
// HELPERS
// =====================================

function element(id) {
  return document.getElementById(id);
}

function show(id) {
  [
    "home",
    "adminLogin",
    "adminGames",
    "adminSetup",
    "joinSetup",
    "adminPanel",
    "playerPanel",
    "coAdminManagement"
  ].forEach(section => {
    element(section).classList.add("hidden");
  });

  element(id).classList.remove("hidden");
  currentView = id;
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[character])
  );
}

function getError(error) {
  alert(error?.message || String(error));
}

function setBusy(id, busy) {
  const button = element(id);
  if (button) button.disabled = busy;
}

function togglePlayerSound() {
  if (
    !("speechSynthesis" in window) ||
    typeof SpeechSynthesisUtterance === "undefined"
  ) {
    return;
  }

  if (playerSoundEnabled && playerSoundReady) {
    playerSoundEnabled = false;
    playerSoundReady = false;
    localStorage.setItem(
      PLAYER_SOUND_KEY,
      "false"
    );
    window.speechSynthesis.cancel();
  } else {
    playerSoundEnabled = true;
    playerSoundReady = true;
    localStorage.setItem(
      PLAYER_SOUND_KEY,
      "true"
    );

    try {
      const activationSpeech =
        new SpeechSynthesisUtterance("Sound enabled");
      activationSpeech.lang = "en-US";
      window.speechSynthesis.speak(activationSpeech);
    } catch (error) {
      console.warn("Player speech activation failed:", error);
    }
  }

  renderPlayerSoundControl();
}

function renderPlayerSoundControl() {
  const button = element("playerSoundToggle");
  if (!button) return;

  const supported =
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined";

  button.disabled = !supported;
  button.textContent = !supported
    ? "Sound unavailable"
    : playerSoundEnabled
      ? playerSoundReady
        ? "Sound ON"
        : "Enable Sound"
      : "Enable Sound (OFF)";
}

function resetPlayerNumberAnnouncements() {
  playerNumberAnnouncements = {
    gameId: null,
    observed: new Set()
  };
}

function initializePlayerNumberAnnouncements() {
  playerNumberAnnouncements = {
    gameId: game?.id ?? null,
    observed: new Set(calledNumbers())
  };
}

function announceNewPlayerNumbers() {
  if (playerNumberAnnouncements.gameId !== game.id) {
    playerNumberAnnouncements = {
      gameId: game.id,
      observed: new Set(calledNumbers())
    };
    return;
  }

  calledNumbers().forEach(number => {
    if (playerNumberAnnouncements.observed.has(number)) {
      return;
    }

    playerNumberAnnouncements.observed.add(number);

    if (!playerSoundEnabled || !playerSoundReady) {
      return;
    }

    try {
      const speech = new SpeechSynthesisUtterance(
        "Number " + number
      );
      speech.lang = "en-US";
      speech.rate = 0.85;
      window.speechSynthesis.speak(speech);
    } catch (error) {
      console.warn("Player number announcement failed:", error);
    }
  });
}

function calledNumbers() {
  return Array.isArray(game?.called)
    ? game.called.map(Number)
    : [];
}

function calledSet() {
  return new Set(calledNumbers());
}

function normalizeGame(data) {
  return {
    ...data,
    called: Array.isArray(data.called)
      ? data.called.map(Number)
      : [],
    prizes: Array.isArray(data.prizes)
      ? data.prizes
      : prizes
  };
}

function activePrizes() {
  return Array.isArray(game?.prizes)
    ? game.prizes
    : prizes;
}

// =====================================
// ADMIN ROLE HELPERS
// =====================================

function isMainAdmin() {
  return Boolean(hostToken && !coAdminToken);
}

function isCoAdmin() {
  return Boolean(coAdminToken);
}

function currentAdminToken() {
  return coAdminToken || hostToken;
}

function updateCoAdminInterface() {
  const isCo = isCoAdmin();

  element("manageCoAdminsBtn")
    .classList.toggle("hidden", isCo);

  element("createNewGameBtn")
    .classList.toggle("hidden", isCo);

  element("backToGamesBtn")
    .classList.toggle("hidden", isCo);

  element("adminLogoutBtn")
    .classList.toggle("hidden", isCo);

  element("adminRoleLabel").textContent =
    isCo
      ? "👑 Co-Admin: " + (coAdminName || "Admin")
      : "👑 Main Admin";
}


// =====================================
// PERMANENT MAIN ADMIN AUTHENTICATION
// =====================================

let authenticatedAdmin = null;

async function verifyMainAdmin() {
  const { data, error } = await db.auth.getUser();

  if (error || !data?.user) {
    authenticatedAdmin = null;
    return false;
  }

  try {
    // Server-side RPC verifies main_admin + active.
    const result = await db.rpc("get_admin_games");

    if (result.error) {
      authenticatedAdmin = null;
      return false;
    }

    authenticatedAdmin = data.user;
    return true;

  } catch (error) {
    console.error("Admin verification failed:", error);
    authenticatedAdmin = null;
    return false;
  }
}

async function openMainAdminLogin() {
  const valid = await verifyMainAdmin();

  if (valid) {
    await loadAdminGames();
  } else {
    show("adminLogin");
  }
}

async function loginMainAdmin() {
  const email = element("adminEmail").value.trim();
  const password = element("adminPassword").value;

  if (!email || !password) {
    alert("Enter your email and password.");
    return;
  }

  setBusy("adminLoginBtn", true);

  try {
    const { error } = await db.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    if (!(await verifyMainAdmin())) {
      await db.auth.signOut();

      throw new Error(
        "This account does not have active Main Admin access."
      );
    }

    element("adminPassword").value = "";

    await loadAdminGames();

  } catch (error) {
    getError(error);
  } finally {
    setBusy("adminLoginBtn", false);
  }
}


function populateGameDropdown(selectId, games) {
  const select = element(selectId);

  select.innerHTML = "";

  if (!games.length) {
    const option = document.createElement("option");

    option.textContent = "No games available";
    option.value = "";

    select.appendChild(option);
    return;
  }

  games.forEach(item => {
    const option = document.createElement("option");

    option.value = item.game_id;

    option.textContent =
      "🎮 " + item.room_code +
      " — " + item.game_status;

    select.appendChild(option);
  });
}

function openSelectedAdminGame(selectId) {
  const gameId = element(selectId).value;

  if (!gameId) {
    alert("Please select a game.");
    return;
  }

  openAdminGame(gameId);
}

async function loadAdminGames() {
  if (!(await verifyMainAdmin())) {
    show("adminLogin");
    return;
  }

  try {
    const { data, error } = await db.rpc(
      "get_admin_games"
    );

    if (error) throw error;

    show("adminGames");

    element("adminWelcome").textContent =
      "Logged in as: " + authenticatedAdmin.email;


    const allGames = data || [];

    const activeGames = allGames.filter(
      item => item.game_status !== "ended"
    );

    const completedGames = allGames.filter(
      item => item.game_status === "ended"
    );

    populateGameDropdown(
      "activeGamesSelect",
      activeGames
    );

    populateGameDropdown(
      "completedGamesSelect",
      completedGames
    );

    element("openActiveGameBtn").disabled =
      activeGames.length === 0;

    element("openCompletedGameBtn").disabled =
      completedGames.length === 0;

    element("adminGamesList").textContent =
      "Total Games: " + allGames.length +
      " | Active: " + activeGames.length +
      " | Completed: " + completedGames.length;

  } catch (error) {
    getError(error);
  }
}

async function openAdminSetup() {
  if (!(await verifyMainAdmin())) {
    show("adminLogin");
    return;
  }

  show("adminSetup");
}

async function openAdminGame(gameId) {
  if (!(await verifyMainAdmin())) {
    show("adminLogin");
    return;
  }

  try {
    const { data, error } = await db.rpc(
      "get_admin_game_access",
      {
        p_game_id: gameId
      }
    );

    if (error) throw error;

    if (!data?.host_token) {
      throw new Error("Game access unavailable.");
    }

    const response = await db
      .from("games")
      .select("*")
      .eq("id", gameId)
      .single();

    if (response.error) throw response.error;

    await resetGameState();

    localStorage.removeItem(CO_ADMIN_SESSION_KEY);

    hostToken = data.host_token;
    game = normalizeGame(response.data);

    saveSession();

    show("adminPanel");
    updateCoAdminInterface();

    await refreshGame();

    if (game) {
      subscribeToGame();
      startRefreshing();
    }

  } catch (error) {
    getError(error);
  }
}

async function returnToAdminGames() {
  if (isCoAdmin()) return;

  await resetGameState();

  localStorage.removeItem(SESSION_KEY);

  await loadAdminGames();
}

async function logoutMainAdmin() {
  await resetGameState();

  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(CO_ADMIN_SESSION_KEY);

  const { error } = await db.auth.signOut();

  if (error) {
    getError(error);
    return;
  }

  authenticatedAdmin = null;

  show("home");
}

// =====================================
// SESSION MANAGEMENT
// =====================================

function saveSession() {
  if (!game) return;

  if (isCoAdmin()) {
    localStorage.setItem(
      CO_ADMIN_SESSION_KEY,
      JSON.stringify({
        token: coAdminToken,
        gameId: game.id
      })
    );

    return;
  }

  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      gameId: game.id,
      hostToken,
      playerToken,
      playerId: player?.id ?? null
    })
  );
}

// =====================================
// PRIZE SELECTION
// =====================================

function renderPrizeSelection() {
  const container = element("prizeSelection");
  container.innerHTML = "";

  prizes.forEach((prize, index) => {
    const label = document.createElement("label");
    label.className = "prize-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = prize;
    checkbox.id = "prize_" + index;
    checkbox.checked = true;
    checkbox.addEventListener(
      "change",
      updatePrizeSelection
    );

    const text = document.createElement("span");
    text.textContent = "🏆 " + prize;

    label.appendChild(checkbox);
    label.appendChild(text);
    container.appendChild(label);
  });

  updatePrizeSelection();
}

function getSelectedPrizes() {
  return prizes.filter(
    (prize, index) =>
      element("prize_" + index)?.checked
  );
}

function selectAllPrizes() {
  prizes.forEach((prize, index) => {
    element("prize_" + index).checked = true;
  });

  updatePrizeSelection();
}

function clearAllPrizes() {
  prizes.forEach((prize, index) => {
    element("prize_" + index).checked = false;
  });

  updatePrizeSelection();
}

function updatePrizeSelection() {
  const selected = getSelectedPrizes();

  element("selectedPrizeCount").textContent =
    "Selected Prizes: " +
    selected.length +
    " of " +
    prizes.length;

  renderCustomPrizeSettings();
}

// =====================================
// CUSTOM WINNING RULES
// =====================================

function updateWinningMode() {
  const custom =
    element("winningMode").value === "custom";

  element("customPrizeSettings")
    .classList.toggle("hidden", !custom);

  renderCustomPrizeSettings();
}

function renderCustomPrizeSettings() {
  const container = element("customPrizeList");
  const previousValues = {};

  prizes.forEach((prize, index) => {
    const oldSelect =
      element("customPrize_" + index);

    if (oldSelect) {
      previousValues[prize] = oldSelect.value;
    }
  });

  container.innerHTML = "";

  getSelectedPrizes().forEach(prize => {
    const index = prizes.indexOf(prize);

    const row = document.createElement("div");
    row.className = "custom-prize-row";

    const label = document.createElement("p");
    label.textContent = "🏆 " + prize;

    const select = document.createElement("select");
    select.id = "customPrize_" + index;

    select.innerHTML = `
      <option value="first_claim">
        ⚡ First to Claim
      </option>
      <option value="same_number">
        🎊 Same Number Winners
      </option>
    `;

    select.value =
      previousValues[prize] || "first_claim";

    row.appendChild(label);
    row.appendChild(select);

    container.appendChild(row);
  });
}

function getCustomPrizeRules() {
  const rules = {};

  getSelectedPrizes().forEach(prize => {
    const index = prizes.indexOf(prize);

    rules[prize] =
      element("customPrize_" + index).value;
  });

  return rules;
}

// =====================================
// TIMER HELPERS
// =====================================

function getClaimDuration() {
  return Number(
    game?.claim_window_seconds ?? 10
  );
}

function currentTime() {
  return Date.now() + serverTimeOffset;
}

function formatSeconds(milliseconds) {
  return Math.max(
    0,
    Math.ceil(milliseconds / 1000)
  ) + "s";
}

function getLatestCall() {
  if (!numberCallHistory.length) return null;

  return numberCallHistory[
    numberCallHistory.length - 1
  ];
}

function getLatestDeadline() {
  const latest = getLatestCall();

  if (!latest) return null;

  const duration = getClaimDuration();

  if (duration === 0) return Infinity;

  const calledAt = Date.parse(
    latest.called_at
  );

  if (!Number.isFinite(calledAt)) {
    return null;
  }

  return calledAt + duration * 1000;
}

async function loadNumberCallHistory(gameId) {
  const { data, error } = await db
    .from("number_calls")
    .select("draw_position,called_at")
    .eq("game_id", gameId)
    .order("draw_position", {
      ascending: true
    });

  if (error) {
    console.warn(
      "Number history unavailable:",
      error
    );

    return false;
  }

  if (!game || game.id !== gameId) {
    return false;
  }

  numberCallHistory = data || [];

  return true;
}

// =====================================
// TIMER DISPLAY
// =====================================

function updateTimerDisplay(boxId, valueId) {
  const box = element(boxId);
  const value = element(valueId);

  if (!box || !value) return;

  box.classList.remove(
    "warning",
    "expired",
    "unlimited"
  );

  const duration = getClaimDuration();

  if (duration === 0) {
    value.textContent = "Unlimited";
    box.classList.add("unlimited");
    return;
  }

  const deadline = getLatestDeadline();

  if (deadline === null) {
    value.textContent = "--";
    return;
  }

  const remaining =
    deadline - currentTime();

  if (remaining <= 0) {
    value.textContent = "Time Up";
    box.classList.add("expired");
    return;
  }

  value.textContent =
    formatSeconds(remaining);

  if (remaining <= 5000) {
    box.classList.add("warning");
  }
}

function updateCountdowns() {
  if (!game) return;

  if (
    currentView === "adminPanel" ||
    currentView === "coAdminManagement"
  ) {
    updateTimerDisplay(
      "adminTimerBox",
      "adminTimer"
    );
  }

  if (currentView === "playerPanel") {
    updateTimerDisplay(
      "playerTimerBox",
      "playerTimer"
    );

    updateClaimCountdowns();
  }
}

function startCountdownTimer() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
  }

  countdownTimer = setInterval(
    updateCountdowns,
    250
  );

  updateCountdowns();
}

// =====================================
// PRIZE COMPLETION DRAW
// =====================================

function getPrizeCompletionDraw(ticket, prize) {
  if (prize === "Any Line") {
    const draws = [
      "Top Line",
      "Middle Line",
      "Bottom Line"
    ].map(line =>
      getPrizeCompletionDraw(ticket, line)
    ).filter(draw => draw !== null);

    return draws.length
      ? Math.min(...draws)
      : null;
  }

  const numbers = patternNumbers(
    ticket,
    prize
  );

  if (!numbers.length) return null;

  const required =
    prize === "Early 5"
      ? 5
      : prize === "Early 7"
        ? 7
        : numbers.length;

  const called = calledNumbers();

  const numberLookup = new Set(
    numbers.map(Number)
  );

  let hits = 0;

  for (
    let i = 0;
    i < called.length;
    i++
  ) {
    if (numberLookup.has(called[i])) {
      hits++;

      if (hits >= required) {
        return i + 1;
      }
    }
  }

  return null;
}

function getPrizeDeadline(ticket, prize) {
  const duration = getClaimDuration();

  if (duration === 0) return Infinity;

  const completionDraw =
    getPrizeCompletionDraw(ticket, prize);

  if (completionDraw === null) {
    return null;
  }

  const call = numberCallHistory.find(
    item =>
      Number(item.draw_position) ===
      completionDraw
  );

  if (!call) return null;

  const calledAt = Date.parse(
    call.called_at
  );

  if (!Number.isFinite(calledAt)) {
    return null;
  }

  return calledAt + duration * 1000;
}

function updateClaimCountdowns() {
  if (!game || !player) return;

  const buttons =
    document.querySelectorAll(
      "[data-claim-ticket][data-claim-prize]"
    );

  buttons.forEach(button => {
    const ticketId =
      button.dataset.claimTicket;

    const prize =
      button.dataset.claimPrize;

    const ticket = tickets.find(
      t => String(t.id) === ticketId
    );

    if (!ticket) return;

    const deadline =
      getPrizeDeadline(ticket, prize);

    const timeLabel =
      button.querySelector(".claim-time");

    if (!timeLabel) return;

    if (getClaimDuration() === 0) {
      timeLabel.textContent = "Unlimited";
      return;
    }

    if (deadline === null) {
      timeLabel.textContent =
        "Checking time";
      return;
    }

    const remaining =
      deadline - currentTime();

    if (remaining <= 0) {
      button.disabled = true;

      button.classList.remove("ready");
      button.classList.add("expired");

      timeLabel.textContent = "Expired";
    } else {
      timeLabel.textContent =
        formatSeconds(remaining);
    }
  });
}

// =====================================
// CLEANUP
// =====================================

async function stopLiveUpdates() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }

  if (realtimeChannel) {
    const oldChannel = realtimeChannel;
    realtimeChannel = null;

    await db.removeChannel(oldChannel);
  }
}

function resetNotifications() {
  initialWinnersLoaded = false;
  lastWinnerIds.clear();

  winnerPopupQueue = [];
  winnerPopupActive = false;

  if (winnerPopupTimer) {
    clearTimeout(winnerPopupTimer);
    winnerPopupTimer = null;
  }

  element("winnerPopup")
    .classList.add("hidden");
}

async function resetGameState() {
  switchingGame = true;

  await stopLiveUpdates();

  game = null;
  player = null;
  tickets = [];

  winners = [];
  players = [];
  marked = {};

  numberCallHistory = [];
  serverTimeOffset = 0;
  resetPlayerNumberAnnouncements();
  resetAnnouncementTracking();

  hostToken = null;
  playerToken = null;

  coAdminToken = null;
  coAdminName = null;

  lastAdminValidation = 0;

  claimingPrizes.clear();
  resetNotifications();

  switchingGame = false;
}

// =====================================
// CREATE GAME
// =====================================

async function prepareNewGame() {
  if (isCoAdmin()) {
    alert(
      "Only the Main Admin can create another game."
    );

    return;
  }

  const confirmed = confirm(
    "Create another game?\n\n" +
    "Your current game will remain in Supabase."
  );

  if (!confirmed) return;

  await openAdminSetup();
}

async function createGame() {
  if (element("createGameBtn").disabled) {
    return;
  }

  if (!(await verifyMainAdmin())) {
    alert("Please log in as Main Admin.");
    show("adminLogin");
    return;
  }

  const selectedPrizes =
    getSelectedPrizes();

  if (!selectedPrizes.length) {
    alert(
      "Please select at least one prize."
    );

    return;
  }

  setBusy("createGameBtn", true);

  try {
    const maxTickets = Number(
      element("maxTickets").value
    );

    const winnersPerPrize = Number(
      element("winnersPerPrize").value
    );

    const winningMode =
      element("winningMode").value;

    const claimWindow = Number(
      element("claimWindow").value
    );

    const customRules =
      winningMode === "custom"
        ? getCustomPrizeRules()
        : {};

    const { data, error } = await db.rpc(
      "create_admin_game",
      {
        p_max_tickets: maxTickets,
        p_winners_per_prize: winnersPerPrize,
        p_winning_mode: winningMode,
        p_claim_window_seconds: claimWindow,
        p_custom_prize_rules: customRules,
        p_prizes: selectedPrizes
      }
    );

    if (error) throw error;

    if (
      !data?.game_id ||
      !data?.host_token
    ) {
      throw new Error(
        "Invalid game response."
      );
    }

    await resetGameState();

    localStorage.removeItem(
      CO_ADMIN_SESSION_KEY
    );

    hostToken = data.host_token;

    game = normalizeGame({
      id: data.game_id,
      code: data.code,
      called: [],
      last_number: null,
      status: "lobby",
      locked: false,
      winners_per_prize: winnersPerPrize,
      winning_mode: winningMode,
      claim_window_seconds: claimWindow,
      prizes: selectedPrizes
    });

    saveSession();

    show("adminPanel");
    updateCoAdminInterface();

    await refreshGame();

    if (game) {
      subscribeToGame();
      startRefreshing();
    }

    alert(
      "🎉 Game Created Successfully!\n\n" +
      "Room Code: " + data.code
    );

  } catch (error) {
    getError(error);
  } finally {
    setBusy("createGameBtn", false);
  }
}

// =====================================
// JOIN GAME
// =====================================

async function joinGame() {
  if (element("joinGameBtn").disabled) {
    return;
  }

  const name =
    element("playerName").value.trim();

  const code =
    element("roomCode")
      .value.trim()
      .toUpperCase();

  const count = Number(
    element("ticketCount").value
  );

  if (!name || !code) {
    alert(
      "Enter your name and room code."
    );

    return;
  }

  setBusy("joinGameBtn", true);

  try {
    const { data, error } = await db.rpc(
      "join_game",
      {
        p_code: code,
        p_name: name,
        p_ticket_count: count
      }
    );

    if (error) throw error;

    if (
      !data?.player_token ||
      !data?.game_id
    ) {
      throw new Error(
        "Invalid player response."
      );
    }

    await resetGameState();

    localStorage.removeItem(
      CO_ADMIN_SESSION_KEY
    );

    playerToken = data.player_token;

    player = {
      id: data.player_id,
      name: data.player_name
    };

    tickets = data.tickets || [];

    game = normalizeGame({
      id: data.game_id,
      code: data.code,
      called: data.called,
      status: data.status,
      prizes: data.prizes
    });

    initializePlayerNumberAnnouncements();

    loadMarks();
    saveSession();

    show("playerPanel");

    await refreshGame();

    if (game) {
      subscribeToGame();
      startRefreshing();
    }

  } catch (error) {
    getError(error);
  } finally {
    setBusy("joinGameBtn", false);
  }
}

// =====================================
// RESTORE PLAYER SESSION
// =====================================

async function restoreSession() {
  const saved = localStorage.getItem(SESSION_KEY);

  if (!saved) return;

  try {
    const session = JSON.parse(saved);

    // Main Admin sessions must be recovered through
    // authenticated, owner-checked Supabase RPCs.
    if (session.hostToken && session.gameId) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }

    if (!session.playerToken) return;

    playerToken = session.playerToken;

    const { data, error } = await db.rpc(
      "get_my_state",
      {
        p_player_token: playerToken
      }
    );

    if (error) throw error;

    player = {
      id: data.player_id,
      name: data.player_name
    };

    tickets = data.tickets || [];

    game = normalizeGame({
      id: data.game_id,
      code: data.code,
      called: data.called,
      status: data.status,
      prizes: data.prizes
    });

    initializePlayerNumberAnnouncements();

    loadMarks();

    show("playerPanel");

    await refreshGame();

    if (game) {
      subscribeToGame();
      startRefreshing();
    }

  } catch (error) {
    console.error(error);

    localStorage.removeItem(SESSION_KEY);

    await resetGameState();

    show("home");
  }
}

// =====================================

// PLAYER WHATSAPP INVITATION
// =====================================

function getPlayerInvitationLink() {
  if (!game) return null;

  const url = new URL(
    window.location.href
  );

  // Remove any previous room or admin credentials.
  url.search = "";
  url.hash = "";

  url.searchParams.set(
    "room",
    game.code
  );

  return url.toString();
}

function sharePlayerWhatsApp() {
  if (!game) {
    alert(
      "Please create a game first."
    );

    return;
  }

  const shareUrl =
    getPlayerInvitationLink();

  const message =
    "🎉 *TAMBOLA PARTY INVITATION* 🎉\n\n" +
    "You're invited to play Tambola with us! 🎟️\n\n" +
    "🎮 *Room Code:* " + game.code + "\n\n" +
    "👇 *Click here to join the game:*\n" +
    shareUrl + "\n\n" +
    "✅ Enter your name\n" +
    "✅ Select your tickets\n" +
    "✅ Join the fun!\n\n" +
    "🏆 Good luck and happy playing! 🎉";

  const whatsappUrl =
    "https://wa.me/?text=" +
    encodeURIComponent(message);

  window.open(
    whatsappUrl,
    "_blank",
    "noopener,noreferrer"
  );
}

// =====================================
// SHARE GAME
// =====================================

async function shareGame() {
  if (!game) return;

  const shareUrl =
    getPlayerInvitationLink();

  if (navigator.share) {
    try {
      await navigator.share({
        title: "Tambola Party",
        text:
          "Join my Tambola game! Room: " +
          game.code,
        url: shareUrl
      });

      return;

    } catch (error) {
      if (
        error.name === "AbortError"
      ) {
        return;
      }
    }
  }

  try {
    await navigator.clipboard.writeText(
      shareUrl
    );

    alert(
      "Player invitation link copied!"
    );

  } catch (error) {
    window.prompt(
      "Copy this invitation link:",
      shareUrl
    );
  }
}

// =====================================
// CO-ADMIN INVITATION MANAGEMENT
// =====================================

async function openCoAdminManagement() {
  if (!game || !isMainAdmin()) {
    alert(
      "Only the Main Admin can manage Co-Admins."
    );

    return;
  }

  element("coAdminInvitationResult")
    .classList.add("hidden");

  show("coAdminManagement");

  await loadCoAdmins();
}

function closeCoAdminManagement() {
  show("adminPanel");

  if (game) {
    renderAdmin();
  }
}

async function generateCoAdminInvitation() {
  if (!game || !isMainAdmin()) {
    alert(
      "Only the Main Admin can invite Co-Admins."
    );

    return;
  }

  const name =
    element("coAdminName").value.trim();

  if (!name) {
    alert(
      "Please enter your friend's name."
    );

    return;
  }

  setBusy("generateCoAdminBtn", true);

  try {
    const { data, error } = await db.rpc(
      "create_co_admin",
      {
        p_game_id: game.id,
        p_host_token: hostToken,
        p_admin_name: name
      }
    );

    if (error) throw error;

    if (!data?.admin_token) {
      throw new Error(
        "Unable to generate invitation."
      );
    }

    const url = new URL(
      window.location.href
    );

    url.search = "";
    url.hash = "";

    url.hash =
      "coadmin=" +
      encodeURIComponent(
        data.admin_token
      );

    element(
      "coAdminInvitationLink"
    ).value = url.toString();

    element("coAdminInvitationResult")
      .classList.remove("hidden");

    await loadCoAdmins();

  } catch (error) {
    getError(error);
  } finally {
    setBusy("generateCoAdminBtn", false);
  }
}

async function copyCoAdminInvitation() {
  const link =
    element("coAdminInvitationLink").value;

  if (!link) return;

  try {
    await navigator.clipboard.writeText(
      link
    );

    alert(
      "✅ Invitation link copied!"
    );

  } catch (error) {
    window.prompt(
      "Copy invitation link:",
      link
    );
  }
}

function shareCoAdminWhatsApp() {
  const link =
    element("coAdminInvitationLink").value;

  if (!link) return;

  const message =
    "👑 Tambola Party Co-Admin Invitation\n\n" +
    "You have been invited to help manage " +
    "my Tambola game.\n\n" +
    "Open this private link:\n" +
    link +
    "\n\nPlease do not share this link.";

  const whatsappUrl =
    "https://wa.me/?text=" +
    encodeURIComponent(message);

  window.open(
    whatsappUrl,
    "_blank",
    "noopener,noreferrer"
  );
}

async function loadCoAdmins() {
  if (!game || !isMainAdmin()) {
    return;
  }

  try {
    const { data, error } = await db.rpc(
      "list_co_admins",
      {
        p_game_id: game.id,
        p_host_token: hostToken
      }
    );

    if (error) throw error;

    const container =
      element("coAdminList");

    container.innerHTML = "";

    const admins = data?.admins || [];

    if (!admins.length) {
      container.textContent =
        "No Co-Admins added yet.";

      return;
    }

    admins.forEach(admin => {
      const row =
        document.createElement("div");

      row.className = "player-row";

      const title =
        document.createElement("strong");

      title.textContent =
        "👑 " + admin.name;

      row.appendChild(title);

      const status =
        document.createElement("p");

      status.className =
        "co-admin-badge" +
        (admin.active
          ? ""
          : " co-admin-revoked");

      status.textContent =
        admin.active
          ? "✅ Active"
          : "🚫 Revoked";

      row.appendChild(status);

      if (admin.active) {
        const button =
          document.createElement("button");

        button.className = "btn-danger";

        button.textContent =
          "🚫 Remove Access";

        button.onclick = () =>
          revokeCoAdmin(
            admin.id,
            admin.name
          );

        row.appendChild(button);
      }

      container.appendChild(row);
    });

  } catch (error) {
    getError(error);
  }
}

async function revokeCoAdmin(
  adminId,
  name
) {
  if (!game || !isMainAdmin()) {
    return;
  }

  const confirmed = confirm(
    "Remove admin access for " +
    name +
    "?"
  );

  if (!confirmed) return;

  try {
    const { error } = await db.rpc(
      "revoke_co_admin",
      {
        p_game_id: game.id,
        p_host_token: hostToken,
        p_admin_id: adminId
      }
    );

    if (error) throw error;

    alert(
      "✅ Co-Admin access removed."
    );

    await loadCoAdmins();

  } catch (error) {
    getError(error);
  }
}

// =====================================
// CO-ADMIN SESSION VALIDATION
// =====================================

async function validateCoAdminAccess(
  force = false
) {
  if (!coAdminToken) return true;

  if (
    adminValidationInProgress
  ) {
    return true;
  }

  const now = Date.now();

  if (
    !force &&
    now - lastAdminValidation < 5000
  ) {
    return true;
  }

  adminValidationInProgress = true;

  try {
    const { data, error } = await db.rpc(
      "join_as_co_admin",
      {
        p_admin_token: coAdminToken
      }
    );

    if (error) {
      throw error;
    }

    if (
      !data?.ok ||
      data.game_id !== game?.id
    ) {
      throw new Error(
        "Co-Admin access is no longer valid."
      );
    }

    lastAdminValidation = Date.now();

    return true;

  } catch (error) {
    console.warn(
      "Co-Admin validation failed:",
      error
    );

    const message = String(
      error?.message || ""
    );

    if (
      /invalid|revoked|not authorised|not authorized/i
        .test(message)
    ) {
      await handleCoAdminRevoked();
    }

    return false;

  } finally {
    adminValidationInProgress = false;
  }
}

async function handleCoAdminRevoked() {
  localStorage.removeItem(
    CO_ADMIN_SESSION_KEY
  );

  localStorage.removeItem(
    SESSION_KEY
  );

  await resetGameState();

  show("home");

  alert(
    "🚫 Your Co-Admin access has been revoked."
  );
}

// =====================================
// JOIN AS CO-ADMIN
// =====================================

async function joinAsCoAdmin(token) {
  if (!token) return false;

  try {
    const { data, error } = await db.rpc(
      "join_as_co_admin",
      {
        p_admin_token: token
      }
    );

    if (error) throw error;

    if (
      !data?.ok ||
      !data?.game_id
    ) {
      throw new Error(
        "Invalid Co-Admin invitation."
      );
    }

    await resetGameState();

    coAdminToken = token;
    coAdminName = data.admin_name;

    hostToken = null;

    game = normalizeGame({
      id: data.game_id,
      code: data.code,
      called: [],
      status: "lobby"
    });

    localStorage.setItem(
      CO_ADMIN_SESSION_KEY,
      JSON.stringify({
        token: coAdminToken,
        gameId: data.game_id
      })
    );

    show("adminPanel");

    updateCoAdminInterface();

    await refreshGame();

    if (game) {
      subscribeToGame();
      startRefreshing();
    }

    return true;

  } catch (error) {
    console.error(error);

    alert(
      "Unable to access Co-Admin dashboard.\n" +
      (error.message || "")
    );

    return false;
  }
}

// =====================================
// HANDLE INVITATION LINK
// =====================================

async function handleCoAdminInvitation() {
  const hash =
    window.location.hash.replace(
      /^#/,
      ""
    );

  const params =
    new URLSearchParams(hash);

  const token =
    params.get("coadmin");

  if (!token) return false;

  const joined = await joinAsCoAdmin(token);

  if (joined) {
    history.replaceState(
      null,
      "",
      window.location.pathname +
      window.location.search
    );
  }

  return joined;
}

// =====================================
// RESTORE CO-ADMIN SESSION
// =====================================

async function restoreCoAdminSession() {
  const saved =
    localStorage.getItem(
      CO_ADMIN_SESSION_KEY
    );

  if (!saved) return false;

  try {
    const session = JSON.parse(saved);

    if (!session.token) {
      return false;
    }

    const joined = await joinAsCoAdmin(
      session.token
    );

    if (!joined) {
      localStorage.removeItem(
        CO_ADMIN_SESSION_KEY
      );
    }

    return joined;

  } catch (error) {
    console.error(error);

    localStorage.removeItem(
      CO_ADMIN_SESSION_KEY
    );

    return false;
  }
}

// =====================================
// REFRESH GAME
// =====================================

async function refreshGame() {
  if (!game || switchingGame) return;

  if (refreshing) {
    refreshAgain = true;
    return;
  }

  refreshing = true;

  const gameId = game.id;

  try {
    if (isCoAdmin()) {
      const valid =
        await validateCoAdminAccess();

      if (!valid) return;
    }

    const { data, error } = await db
      .from("games")
      .select("*")
      .eq("id", gameId)
      .single();

    if (error) throw error;

    if (
      !game ||
      game.id !== gameId
    ) {
      return;
    }

    game = normalizeGame(data);

    if (
      game.status === "ended" &&
      currentView === "playerPanel"
    ) {
      switchingGame = true;

      localStorage.removeItem(
        SESSION_KEY
      );

      await stopLiveUpdates();

      game = null;
      player = null;
      playerToken = null;

      tickets = [];
      winners = [];
      marked = {};

      numberCallHistory = [];

      resetNotifications();

      show("home");

      switchingGame = false;

      alert(
        "🏁 The Tambola Game Has Ended!\n\n" +
        "Thank you for playing! 🎉"
      );

      return;
    }

    await loadNumberCallHistory(
      gameId
    );

    if (
      !game ||
      game.id !== gameId
    ) {
      return;
    }

    const {
      data: winnerData,
      error: winnerError
    } = await db
      .from("winners")
      .select("*")
      .eq("game_id", gameId)
      .order("won_at", {
        ascending: true
      });

    if (winnerError) {
      throw winnerError;
    }

    if (
      !game ||
      game.id !== gameId
    ) {
      return;
    }

    winners = winnerData || [];

    if (
      currentView === "adminPanel" ||
      currentView === "coAdminManagement"
    ) {
      const {
        data: playerData,
        error: playerError
      } = await db.rpc(
        "get_game_player_ticket_counts",
        {
          p_game_id: gameId,
          p_host_token: currentAdminToken()
        }
      );

      if (!playerError) {
        players = (playerData || []).map(p => ({
          id: p.player_id,
          name: p.player_name,
          ticket_count: Number(p.ticket_count)
        }));
      } else {
        console.warn(
          "Ticket counts unavailable:",
          playerError
        );
      }

      renderAdmin();
    }

    if (
      currentView === "playerPanel"
    ) {
      renderPlayer();
    }

    checkNewWinners();
    updateCountdowns();

    if (currentView === "playerPanel") {
      await checkGameAnnouncements();
    }

  } catch (error) {
    console.error(
      "Refresh error:",
      error
    );

  } finally {
    refreshing = false;

    if (refreshAgain) {
      refreshAgain = false;

      if (
        game &&
        !switchingGame
      ) {
        setTimeout(
          refreshGame,
          0
        );
      }
    }
  }
}

// =====================================
// REALTIME
// =====================================

function subscribeToGame() {
  if (!game) return;

  const gameId = game.id;

  if (realtimeChannel) {
    db.removeChannel(
      realtimeChannel
    );

    realtimeChannel = null;
  }

  const channel = db.channel(
    "tambola-" +
    gameId +
    "-" +
    Math.random()
      .toString(36)
      .slice(2)
  );

  channel
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "games",
        filter: "id=eq." + gameId
      },
      refreshGame
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "winners",
        filter: "game_id=eq." + gameId
      },
      refreshGame
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "players",
        filter: "game_id=eq." + gameId
      },
      refreshGame
    )
    .subscribe(status => {
      if (
        status === "CHANNEL_ERROR"
      ) {
        console.warn(
          "Realtime unavailable. Polling active."
        );
      }
    });

  realtimeChannel = channel;
}

function startRefreshing() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  refreshTimer = setInterval(
    refreshGame,
    3000
  );

  startCountdownTimer();
}

// =====================================
// ADMIN CONTROLS
// =====================================

async function callNextNumber() {
  if (
    !game ||
    !currentAdminToken() ||
    callingNumber
  ) {
    return;
  }

  if (
    game.status === "ended" ||
    game.status === "paused" ||
    calledNumbers().length >= 90
  ) {
    return;
  }

  callingNumber = true;

  element("callNextBtn").disabled = true;

  try {
    if (
      isCoAdmin() &&
      !(await validateCoAdminAccess(true))
    ) {
      return;
    }

    const { data, error } = await db.rpc(
      "call_number",
      {
        p_game_id: game.id,
        p_host_token: currentAdminToken()
      }
    );

    if (error) throw error;

    if (data?.number != null) {
      announceNumber(
        data.number
      );
    }

    await refreshGame();

  } catch (error) {
    getError(error);
  } finally {
    callingNumber = false;

    if (game) {
      updateAdminControls();
    }
  }
}

function announceNumber(number) {
  if (
    !("speechSynthesis" in window)
  ) {
    return;
  }

  try {
    speechSynthesis.cancel();

    const speech =
      new SpeechSynthesisUtterance(
        "Number " + number
      );

    speech.rate = 0.85;

    speechSynthesis.speak(speech);

  } catch (error) {
    console.warn(error);
  }
}

async function setStatus(status) {
  if (
    !game ||
    !currentAdminToken()
  ) {
    return false;
  }

  try {
    if (
      isCoAdmin() &&
      !(await validateCoAdminAccess(true))
    ) {
      return false;
    }

    const { error } = await db.rpc(
      "set_game_state",
      {
        p_game_id: game.id,
        p_host_token: currentAdminToken(),
        p_status: status
      }
    );

    if (error) throw error;

    await refreshGame();

    return true;

  } catch (error) {
    getError(error);
    return false;
  }
}

async function togglePause() {
  if (
    game &&
    game.status !== "ended"
  ) {
    await setStatus("paused");
  }
}

async function resumeGame() {
  if (
    game &&
    game.status !== "ended"
  ) {
    await setStatus("running");
  }
}

async function endGame() {
  if (
    !game ||
    game.status === "ended"
  ) {
    return;
  }

  if (
    !confirm(
      "Are you sure you want to END this game?"
    )
  ) {
    return;
  }

  if (
    await setStatus("ended")
  ) {
    alert(
      "Game ended successfully."
    );
  }
}

async function toggleLock() {
  if (
    !game ||
    !currentAdminToken() ||
    game.status === "ended"
  ) {
    return;
  }

  try {
    if (
      isCoAdmin() &&
      !(await validateCoAdminAccess(true))
    ) {
      return;
    }

    const { error } = await db.rpc(
      "set_game_state",
      {
        p_game_id: game.id,
        p_host_token: currentAdminToken(),
        p_locked: !game.locked
      }
    );

    if (error) throw error;

    await refreshGame();

  } catch (error) {
    getError(error);
  }
}

// =====================================
// ADMIN DISPLAY
// =====================================

function updateAdminControls() {
  if (!game) return;

  const ended =
    game.status === "ended";

  const paused =
    game.status === "paused";

  element("pauseBtn")
    .classList.toggle(
      "hidden",
      paused || ended
    );

  element("resumeBtn")
    .classList.toggle(
      "hidden",
      !paused || ended
    );

  element("pauseBtn").disabled = ended;
  element("resumeBtn").disabled = ended;
  element("endBtn").disabled = ended;
  element("lockBtn").disabled = ended;

  element("lockBtn").textContent =
    game.locked
      ? "🔓 Unlock Entries"
      : "🔒 Lock Entries";

  element("callNextBtn").disabled =
    ended ||
    paused ||
    callingNumber ||
    calledNumbers().length >= 90;

  updateCoAdminInterface();
}

function renderAdmin() {
  if (!game) return;

  const called = calledNumbers();

  const calledLookup =
    new Set(called);

  element("adminRoomCode").textContent =
    "Room Code: " + game.code;

  element("adminNumber").textContent =
    game.last_number ?? "--";

  element("calledCount").textContent =
    "Numbers Called: " +
    called.length +
    "/90";

  element("gameStatus").textContent =
    "Status: " + game.status;

  element("entryStatus").textContent =
    "Entries: " +
    (game.locked
      ? "Locked"
      : "Open");

  element("adminActivePrizes").textContent =
    activePrizes().join(" • ");

  updateAdminControls();

  const board =
    element("numberBoard");

  board.innerHTML = "";

  for (
    let n = 1;
    n <= 90;
    n++
  ) {
    const cell =
      document.createElement("div");

    cell.className =
      "board-cell";

    if (
      calledLookup.has(n)
    ) {
      cell.classList.add(
        "called"
      );
    }

    cell.textContent = n;

    board.appendChild(cell);
  }

  element("playerList").textContent =
    "Total Players: " +
    players.length;

  const container =
    element("adminPlayersList");

  container.innerHTML = "";

  players.forEach(
    (p, index) => {
      const row =
        document.createElement("div");

      row.className =
        "player-row";

      const count = Number(p.ticket_count || 0);

      row.textContent =
        (index + 1) +
        ". 🎟️ " +
        p.name +
        " — " +
        count +
        (count === 1 ? " Ticket" : " Tickets");

      container.appendChild(row);
    }
  );

  renderPendingClaims();
  renderWinners();
}

function renderPendingClaims() {
  element("pendingClaims").textContent =
    "Claims are processed by the game server. " +
    "No pending-claim review API is configured.";
}

// =====================================
// PLAYER MARKING
// =====================================

function loadMarks() {
  if (!player) return;

  const key =
    "tambola_marks_" +
    player.id;

  try {
    const stored = JSON.parse(
      localStorage.getItem(key) ||
      "{}"
    );

    marked =
      stored &&
      typeof stored === "object" &&
      !Array.isArray(stored)
        ? stored
        : {};

  } catch (error) {
    marked = {};
  }
}

function saveMarks() {
  if (!player) return;

  localStorage.setItem(
    "tambola_marks_" + player.id,
    JSON.stringify(marked)
  );
}

function toggleMark(ticketId, number) {
  if (
    !game ||
    !player
  ) {
    return;
  }

  const numericNumber =
    Number(number);

  if (
    !calledSet().has(numericNumber)
  ) {
    return;
  }

  if (
    !Array.isArray(
      marked[ticketId]
    )
  ) {
    marked[ticketId] = [];
  }

  marked[ticketId] =
    marked[ticketId].map(Number);

  const values =
    marked[ticketId];

  if (
    values.includes(numericNumber)
  ) {
    marked[ticketId] =
      values.filter(
        n => n !== numericNumber
      );
  } else {
    values.push(
      numericNumber
    );
  }

  saveMarks();
  renderPlayer();
}


function renderPlayerNumberBoard() {
  const board = element("playerNumberBoard");

  if (!board || !game) return;

  const called = calledSet();

  board.innerHTML = "";

  for (let n = 1; n <= 90; n++) {
    const cell = document.createElement("div");

    cell.className = "board-cell";

    if (called.has(n)) {
      cell.classList.add("called");
    }

    cell.textContent = n;

    board.appendChild(cell);
  }
}

// =====================================
// PLAYER DISPLAY
// =====================================

function renderPlayer() {
  if (
    !player ||
    !game
  ) {
    return;
  }

  const called =
    calledSet();

  announceNewPlayerNumbers();
  renderPlayerSoundControl();
  renderPlayerNumberBoard();

  element("welcomePlayer").textContent =
    "Welcome, " +
    player.name +
    "! 🎉";

  element("playerRoom").textContent =
    "Room: " +
    game.code;

  element("playerNumber").textContent =
    game.last_number ?? "--";

  element("playerCalledCount").textContent =
    "Numbers Called: " +
    called.size +
    "/90";

  element("playerGameStatus").textContent =
    "Game Status: " +
    game.status;

  const duration =
    getClaimDuration();

  element("playerClaimDuration").textContent =
    duration === 0
      ? "Unlimited"
      : duration + " seconds";

  const container =
    element("ticketsContainer");

  container.innerHTML = "";

  tickets.forEach(ticket => {
    const heading =
      document.createElement("h3");

    heading.textContent =
      "🎟️ Ticket #" +
      ticket.ticket_no;

    container.appendChild(
      heading
    );

    const grid =
      document.createElement("div");

    grid.className =
      "ticket";

    if (
      !Array.isArray(
        ticket.numbers
      )
    ) {
      const error =
        document.createElement("p");

      error.textContent =
        "Ticket data is unavailable.";

      container.appendChild(error);
      return;
    }

    ticket.numbers.forEach(row => {
      if (
        !Array.isArray(row)
      ) {
        return;
      }

      row.forEach(number => {
        const cell =
          document.createElement(
            number === null
              ? "div"
              : "button"
          );

        cell.className =
          "ticket-cell";

        if (
          number === null
        ) {
          cell.classList.add(
            "empty"
          );
        } else {
          const numericNumber =
            Number(number);

          const wasCalled =
            called.has(
              numericNumber
            );

          const isMarked =
            wasCalled &&
            Array.isArray(
              marked[ticket.id]
            ) &&
            marked[ticket.id]
              .map(Number)
              .includes(
                numericNumber
              );

          cell.textContent =
            numericNumber;

          cell.type =
            "button";

          if (isMarked) {
            cell.classList.add(
              "marked"
            );
          } else if (wasCalled) {
            cell.classList.add(
              "called"
            );
          } else {
            cell.classList.add(
              "uncalled"
            );

            cell.disabled = true;
          }

          cell.onclick = () =>
            toggleMark(
              ticket.id,
              numericNumber
            );
        }

        grid.appendChild(
          cell
        );
      });
    });

    container.appendChild(
      grid
    );
  });

  renderClaims();
  renderWinners();
  updateCountdowns();
}

// =====================================
// PRIZE PATTERNS
// =====================================

function rowNumbers(ticket, row) {
  if (
    !Array.isArray(ticket.numbers) ||
    !Array.isArray(
      ticket.numbers[row]
    )
  ) {
    return [];
  }

  return ticket.numbers[row]
    .filter(
      n => n !== null
    )
    .map(Number);
}

function patternNumbers(ticket, prize) {
  const top =
    rowNumbers(ticket, 0);

  const middle =
    rowNumbers(ticket, 1);

  const bottom =
    rowNumbers(ticket, 2);

  const all = [
    ...top,
    ...middle,
    ...bottom
  ];

  if (prize === "Any Line") {
    return [
      ...top,
      ...middle,
      ...bottom
    ];
  }

  if (
    prize === "Top Line"
  ) {
    return top;
  }

  if (
    prize === "Middle Line"
  ) {
    return middle;
  }

  if (
    prize === "Bottom Line"
  ) {
    return bottom;
  }

  if (
    prize === "Four Corners"
  ) {
    if (
      !top.length ||
      !bottom.length
    ) {
      return [];
    }

    return [
      top[0],
      top[top.length - 1],
      bottom[0],
      bottom[bottom.length - 1]
    ];
  }

  if (
    prize === "Early 5" ||
    prize === "Early 7" ||
    prize === "Full House"
  ) {
    return all;
  }

  return [];
}

function qualifies(ticket, prize) {
  if (
    !game ||
    !activePrizes().includes(prize)
  ) {
    return false;
  }

  const numbers =
    patternNumbers(ticket, prize);

  if (!numbers.length) return false;

  const called = calledSet();

  if (prize === "Any Line") {
    return [0, 1, 2].some(row => {
      const line = rowNumbers(ticket, row);

      return line.length > 0 &&
        line.every(n => called.has(n));
    });
  }

  const hits = numbers.filter(
    n => called.has(n)
  ).length;

  if (
    prize === "Early 5"
  ) {
    return hits >= 5;
  }

  if (
    prize === "Early 7"
  ) {
    return hits >= 7;
  }

  return hits === numbers.length;
}

// =====================================
// CLAIM BUTTONS
// =====================================

function renderClaims() {
  if (
    !game ||
    !player
  ) {
    return;
  }

  const container =
    element("claimContainer");

  container.innerHTML = "";

  const gamePrizes =
    activePrizes();

  tickets.forEach(ticket => {
    const heading =
      document.createElement("h3");

    heading.textContent =
      "🎟️ Ticket #" +
      ticket.ticket_no;

    container.appendChild(
      heading
    );

    const buttonRow =
      document.createElement("div");

    buttonRow.className =
      "claim-buttons";

    gamePrizes.forEach(prize => {
      const alreadyWon =
        winners.some(
          w =>
            w.ticket_id === ticket.id &&
            w.prize === prize
        );

      if (alreadyWon) {
        const badge =
          document.createElement("span");

        badge.className =
          "winner";

        badge.textContent =
          "🏆 " +
          prize +
          " WON!";

        buttonRow.appendChild(
          badge
        );

        return;
      }

      const eligible =
        qualifies(
          ticket,
          prize
        );

      const winnerCount =
        winners.filter(
          w => w.prize === prize
        ).length;

      const maxWinners =
        Number(
          game.winners_per_prize ?? 1
        );

      const prizeFull =
        winnerCount >= maxWinners;

      const claimKey =
        ticket.id +
        "_" +
        prize;

      const claimInProgress =
        claimingPrizes.has(
          claimKey
        );

      const gameAllowsClaims =
        game.status !== "ended" &&
        game.status !== "paused";

      const deadline =
        eligible
          ? getPrizeDeadline(
              ticket,
              prize
            )
          : null;

      const expired =
        eligible &&
        deadline !== null &&
        deadline !== Infinity &&
        currentTime() >= deadline;

      const button =
        document.createElement("button");

      button.className =
        "prize-button";

      button.dataset.claimTicket =
        String(ticket.id);

      button.dataset.claimPrize =
        prize;

      button.disabled =
        !eligible ||
        prizeFull ||
        !gameAllowsClaims ||
        claimInProgress ||
        expired;

      if (
        eligible &&
        !prizeFull &&
        !expired &&
        gameAllowsClaims
      ) {
        button.classList.add(
          "ready"
        );
      }

      if (expired) {
        button.classList.add(
          "expired"
        );
      }

      const label =
        document.createElement("span");

      label.textContent =
        claimInProgress
          ? "⏳ Claiming..."
          : prizeFull
            ? "🏆 " + prize + " Closed"
            : expired
              ? "⌛ " + prize
              : eligible
                ? "🏆 Claim " + prize
                : "🔒 " + prize;

      button.appendChild(
        label
      );

      if (
        eligible &&
        !prizeFull &&
        !claimInProgress
      ) {
        const time =
          document.createElement("span");

        time.className =
          "claim-time";

        if (expired) {
          time.textContent =
            "Expired";
        } else if (
          deadline === Infinity
        ) {
          time.textContent =
            "Unlimited";
        } else if (
          deadline === null
        ) {
          time.textContent =
            "Checking time";
        } else {
          time.textContent =
            formatSeconds(
              deadline - currentTime()
            );
        }

        button.appendChild(
          time
        );
      }

      button.onclick = () =>
        claimPrize(
          ticket.id,
          prize
        );

      buttonRow.appendChild(
        button
      );
    });

    container.appendChild(
      buttonRow
    );
  });
}

// =====================================
// SERVER CLAIM
// =====================================

async function claimPrize(
  ticketId,
  prize
) {
  if (
    !playerToken ||
    !game ||
    !activePrizes().includes(prize)
  ) {
    return;
  }

  const claimKey =
    ticketId +
    "_" +
    prize;

  if (
    claimingPrizes.has(
      claimKey
    )
  ) {
    return;
  }

  claimingPrizes.add(
    claimKey
  );

  renderClaims();

  try {
    const { data, error } = await db.rpc(
      "claim_prize",
      {
        p_player_token: playerToken,
        p_ticket_id: ticketId,
        p_prize: prize
      }
    );

    if (error) throw error;

    if (
      data?.ok === true
    ) {
      alert(
        "🏆 Congratulations!\n" +
        "You won " +
        prize +
        "!"
      );
    } else {
      alert(
        data?.message ||
        data?.reason ||
        "Your claim was not accepted."
      );
    }

    await refreshGame();

  } catch (error) {
    getError(error);

    await refreshGame();

  } finally {
    claimingPrizes.delete(
      claimKey
    );

    if (
      game &&
      currentView === "playerPanel"
    ) {
      renderClaims();
    }
  }
}

// =====================================
// WINNER ANNOUNCEMENTS
// =====================================

function checkNewWinners() {
  if (!initialWinnersLoaded) {
    winners.forEach(
      w => lastWinnerIds.add(w.id)
    );

    initialWinnersLoaded = true;
    return;
  }

  const newWinners =
    winners.filter(
      w => !lastWinnerIds.has(w.id)
    );

  winners.forEach(
    w => lastWinnerIds.add(w.id)
  );

  newWinners.forEach(
    winner =>
      winnerPopupQueue.push(
        winner
      )
  );

  showNextWinnerPopup();
}

function showNextWinnerPopup() {
  if (
    winnerPopupActive ||
    !winnerPopupQueue.length
  ) {
    return;
  }

  const winner =
    winnerPopupQueue.shift();

  winnerPopupActive = true;

  element("winnerName").textContent =
    winner.player_name ||
    "Winner";

  element("winnerPrize").textContent =
    "🏆 " +
    winner.prize;

  element("winnerTicket").textContent =
    "Ticket #" +
    winner.ticket_no;

  element("winnerPopup")
    .classList.remove("hidden");

  winnerPopupTimer = setTimeout(
    closePopup,
    5000
  );
}

function closePopup() {
  if (winnerPopupTimer) {
    clearTimeout(
      winnerPopupTimer
    );

    winnerPopupTimer = null;
  }

  element("winnerPopup")
    .classList.add("hidden");

  winnerPopupActive = false;

  if (
    winnerPopupQueue.length
  ) {
    setTimeout(
      showNextWinnerPopup,
      300
    );
  }
}

function renderWinners() {
  const html =
    winners.length
      ? winners.map(
          w => `
            <div class="winner">
              🏆 ${escapeHtml(w.player_name)}
              won
              <strong>
                ${escapeHtml(w.prize)}
              </strong>
              —
              Ticket #
              ${escapeHtml(w.ticket_no)}
            </div>
          `
        ).join("")
      : "<p>No winners yet.</p>";

  element("adminWinners").innerHTML =
    html;

  element("playerWinners").innerHTML =
    html;
}


// =====================================
// MANUAL ANNOUNCEMENTS
// =====================================

let announcementGameId = null;
let announcementInitialized = false;
let lastAnnouncementTime = null;
let lastAnnouncementId = null;
let announcementRequestInProgress = false;

function resetAnnouncementTracking() {
  announcementGameId = null;
  announcementInitialized = false;
  lastAnnouncementTime = null;
  lastAnnouncementId = null;
}

async function sendAdminAnnouncement() {
  if (!game || !currentAdminToken()) {
    alert("Admin access required.");
    return;
  }

  const select = element("adminAnnouncementSelect");
  const phrase = select.value;

  setBusy("sendAnnouncementBtn", true);

  try {
    if (
      isCoAdmin() &&
      !(await validateCoAdminAccess(true))
    ) {
      throw new Error("Co-Admin access unavailable.");
    }

    const { error } = await db.rpc(
      "send_game_announcement",
      {
        p_game_id: game.id,
        p_host_token: currentAdminToken(),
        p_phrase: phrase
      }
    );

    if (error) throw error;

    element("announcementStatus").textContent =
      "✅ Announcement sent: " + phrase;

  } catch (error) {
    getError(error);

  } finally {
    setBusy("sendAnnouncementBtn", false);
  }
}

function speakFunAnnouncement(phrase) {
  if (
    !playerSoundEnabled ||
    !playerSoundReady ||
    !("speechSynthesis" in window)
  ) {
    return;
  }

  try {
    const speech =
      new SpeechSynthesisUtterance(phrase);

    speech.lang = "en-US";
    speech.rate = 0.9;

    window.speechSynthesis.speak(speech);

  } catch (error) {
    console.warn(
      "Announcement speech failed:",
      error
    );
  }
}

async function checkGameAnnouncements() {
  if (
    !game ||
    !playerToken ||
    currentView !== "playerPanel" ||
    announcementRequestInProgress
  ) {
    return;
  }

  const gameId = game.id;

  if (announcementGameId !== gameId) {
    resetAnnouncementTracking();
    announcementGameId = gameId;
  }

  announcementRequestInProgress = true;

  try {
    const { data, error } = await db.rpc(
      "get_game_announcements",
      {
        p_player_token: playerToken
      }
    );

    if (error) throw error;

    if (
      !game ||
      game.id !== gameId ||
      currentView !== "playerPanel"
    ) {
      return;
    }

    const announcements = (data || [])
      .slice()
      .reverse();

    if (!announcementInitialized) {
      const latest =
        announcements[announcements.length - 1];

      if (latest) {
        lastAnnouncementTime = latest.created_at;
        lastAnnouncementId = latest.announcement_id;
      }

      announcementInitialized = true;
      return;
    }

    for (const item of announcements) {
      const timestamp = item.created_at;
      const id = item.announcement_id;

      const isNew =
        !lastAnnouncementTime ||
        timestamp > lastAnnouncementTime ||
        (
          timestamp === lastAnnouncementTime &&
          String(id) > String(lastAnnouncementId)
        );

      if (!isNew) continue;

      speakFunAnnouncement(item.phrase);

      lastAnnouncementTime = timestamp;
      lastAnnouncementId = id;
    }

  } catch (error) {
    console.warn(
      "Announcement refresh failed:",
      error
    );

  } finally {
    announcementRequestInProgress = false;
  }
}

// =====================================
// INITIALISE
// =====================================

async function initialise() {
  renderPrizeSelection();
  updateWinningMode();

  const params = new URLSearchParams(
    window.location.search
  );

  const room = params.get("room");

  if (room) {
    element("roomCode").value =
      room.toUpperCase();
  }

  const hashParams = new URLSearchParams(
    window.location.hash.replace(/^#/, "")
  );

  // Invitation links take priority.
  if (hashParams.has("coadmin")) {
    const joined = await handleCoAdminInvitation();

    if (joined) return;
  }

  // Player invitation links take priority over
  // an existing administrator login.
  if (room) {
    await restoreSession();

    if (!game) {
      show("joinSetup");
    }

    return;
  }

  const restoredCoAdmin =
    await restoreCoAdminSession();

  if (restoredCoAdmin) return;

  // Restore permanent Main Admin login.
  if (await verifyMainAdmin()) {
    await loadAdminGames();
    return;
  }

  // Restore ordinary player session.
  await restoreSession();
}

initialise();

