from pathlib import Path
import html

SOURCE = Path("index.html")
OUTPUT = Path("index-upgraded.html")

PHRASES = [
    "Anyone sweating?",
    "Keep your eyes on the prize!",
    "Don't blink or you'll miss it!",
    "Feeling lucky?",
    "Wake up, sleepyheads!",
    "The tension is rising!",
    "One number closer!",
    "Who's getting excited?",
    "Are you still in the game?",
    "House is just around the corner!",
    "Someone's getting lucky tonight!",
    "Don't let your luck run out!",
    "The winner could be you!",
    "Eyes down, dabbers ready!",
    "Is anyone shouting Housie yet?"
]


def replace_once(content, old, new):
    count = content.count(old)

    if count != 1:
        raise RuntimeError(
            f"Expected one match, found {count}: "
            + old[:80]
        )

    return content.replace(old, new, 1)


def replace_function(content, name, replacement):
    marker = f"function {name}("

    start = content.find(marker)

    if start < 0:
        raise RuntimeError(
            f"Function not found: {name}"
        )

    brace = content.find("{", start)

    if brace < 0:
        raise RuntimeError(
            f"Invalid function: {name}"
        )

    depth = 0
    end = None

    for position in range(brace, len(content)):
        character = content[position]

        if character == "{":
            depth += 1

        elif character == "}":
            depth -= 1

            if depth == 0:
                end = position + 1
                break

    if end is None:
        raise RuntimeError(
            f"Function closing brace not found: {name}"
        )

    return (
        content[:start]
        + replacement.strip()
        + content[end:]
    )


def upgrade():
    content = SOURCE.read_text(encoding="utf-8")

    # ========================================
    # 1. ANY LINE PRIZE
    # ========================================

    content = replace_once(
        content,
        '''const prizes = [
  "Early 5",
  "Early 7",
  "Top Line",''',
        '''const prizes = [
  "Early 5",
  "Early 7",
  "Any Line",
  "Top Line",'''
    )

    # Add browser-side Any Line qualification.

    content = replace_once(
        content,
        '''  if (
    prize === "Top Line"
  ) {
    return top;
  }''',
        '''  if (prize === "Any Line") {
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
  }'''
    )

    # Update eligibility calculation.

    content = replace_once(
        content,
        '''  const numbers =
    patternNumbers(
      ticket,
      prize
    );

  if (!numbers.length) {
    return false;
  }

  const called =
    calledSet();

  const hits =
    numbers.filter(
      n => called.has(n)
    ).length;''',
        '''  const numbers =
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
  ).length;'''
    )

    # Add the correct completion draw for Any Line.

    content = replace_once(
        content,
        '''function getPrizeCompletionDraw(ticket, prize) {
  const numbers = patternNumbers(''',
        '''function getPrizeCompletionDraw(ticket, prize) {
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

  const numbers = patternNumbers('''
    )

    print("✅ Any Line added")

    # ========================================
    # 2. PLAYER NUMBER BOARD
    # ========================================

    player_board = '''
  <div class="card">
    <h2>🔢 Number Board (1–90)</h2>

    <p class="ticket-legend">
      🟡 Yellow = Called Number
    </p>

    <div
      id="playerNumberBoard"
      class="board"
    ></div>
  </div>

'''

    content = replace_once(
        content,
        '''  <div class="card player-claims-card">''',
        player_board +
        '''  <div class="card player-claims-card">'''
    )

    player_board_js = '''
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

'''

    content = replace_once(
        content,
        '''// =====================================
// PLAYER DISPLAY
// =====================================''',
        player_board_js +
        '''// =====================================
// PLAYER DISPLAY
// ====================================='''
    )

    content = replace_once(
        content,
        '''  announceNewPlayerNumbers();
  renderPlayerSoundControl();''',
        '''  announceNewPlayerNumbers();
  renderPlayerSoundControl();
  renderPlayerNumberBoard();'''
    )

    print("✅ Player number board added")

    # ========================================
    # 3. MANUAL ANNOUNCEMENTS
    # ========================================

    options = "\n".join(
        f'<option value="{html.escape(p, quote=True)}">'
        f'{html.escape(p)}</option>'
        for p in PHRASES
    )

    announcement_html = f'''
      <div class="card">
        <h2>🎙️ Fun Announcements</h2>

        <p>
          Select a phrase to announce to players.
        </p>

        <select
          id="adminAnnouncementSelect"
          style="width:100%;max-width:500px"
        >
          {options}
        </select>

        <br>

        <button
          id="sendAnnouncementBtn"
          class="btn-success"
          onclick="sendAdminAnnouncement()"
        >
          🎙️ Announce
        </button>

        <p id="announcementStatus"></p>
      </div>

'''

    content = replace_once(
        content,
        '''  <div class="admin-grid">''',
        announcement_html +
        '''  <div class="admin-grid">'''
    )

    announcement_js = '''
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

'''

    content = replace_once(
        content,
        '''// =====================================
// INITIALISE
// =====================================''',
        announcement_js +
        '''// =====================================
// INITIALISE
// ====================================='''
    )

    # Poll through the existing refresh mechanism.

    content = replace_once(
        content,
        '''    checkNewWinners();
    updateCountdowns();''',
        '''    checkNewWinners();
    updateCountdowns();

    if (currentView === "playerPanel") {
      await checkGameAnnouncements();
    }'''
    )

    content = replace_once(
        content,
        '''  resetPlayerNumberAnnouncements();

  hostToken = null;''',
        '''  resetPlayerNumberAnnouncements();
  resetAnnouncementTracking();

  hostToken = null;'''
    )

    print("✅ Manual announcements added")

    # ========================================
    # 4. PLAYER TICKET COUNTS
    # ========================================

    content = replace_once(
        content,
        '''      const {
        data: playerData,
        error: playerError
      } = await db
        .from("players")
        .select("id,name")
        .eq("game_id", gameId);

      if (!playerError) {
        players = playerData || [];
      }

      renderAdmin();''',
        '''      const {
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

      renderAdmin();'''
    )

    content = replace_once(
        content,
        '''      row.textContent =
        (index + 1) +
        ". 🎟️ " +
        p.name;''',
        '''      const count = Number(p.ticket_count || 0);

      row.textContent =
        (index + 1) +
        ". 🎟️ " +
        p.name +
        " — " +
        count +
        (count === 1 ? " Ticket" : " Tickets");'''
    )

    print("✅ Player ticket counts added")

    # ========================================
    # 5. ADMIN GAME LIST REDESIGN
    # ========================================

    old_admin_html = '''  <div id="adminGamesList"></div>

  <button
    onclick="openAdminSetup()"
    class="btn-success"
  >
    ➕ Create New Game
  </button>

  <button
    onclick="logoutMainAdmin()"
    class="btn-danger"
  >
    🚪 Logout
  </button>'''

    new_admin_html = '''  <div class="admin-actions">

    <button
      onclick="openAdminSetup()"
      class="btn-success"
    >
      🟢 Create New Game
    </button>

    <button
      onclick="logoutMainAdmin()"
      class="btn-danger"
    >
      🔴 Logout
    </button>

  </div>

  <hr>

  <h3>🎮 Active Games</h3>

  <select
    id="activeGamesSelect"
    style="width:100%;max-width:500px"
  ></select>

  <br>

  <button
    id="openActiveGameBtn"
    onclick="openSelectedAdminGame('activeGamesSelect')"
  >
    👑 Open Selected Dashboard
  </button>

  <hr>

  <h3>📁 Completed Games</h3>

  <select
    id="completedGamesSelect"
    style="width:100%;max-width:500px"
  ></select>

  <br>

  <button
    id="openCompletedGameBtn"
    onclick="openSelectedAdminGame('completedGamesSelect')"
  >
    👑 Open Selected Dashboard
  </button>

  <p id="adminGamesList"></p>'''

    content = replace_once(
        content,
        old_admin_html,
        new_admin_html
    )

    admin_games_js = '''
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

'''

    content = replace_once(
        content,
        '''async function loadAdminGames() {''',
        admin_games_js +
        '''async function loadAdminGames() {'''
    )

    start = content.index(
        '    const container = element("adminGamesList");',
        content.index('async function loadAdminGames()')
    )

    end = content.index(
        '\n  } catch (error) {',
        start
    )

    replacement = '''
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
'''

    content = (
        content[:start]
        + replacement
        + content[end:]
    )

    print("✅ Admin Dashboard redesigned")

    # ========================================
    # SAVE UPGRADED WEBSITE
    # ========================================

    OUTPUT.write_text(
        content,
        encoding="utf-8"
    )

    print("")
    print("===================================")
    print("🎉 TAMBOLA PARTY UPGRADE COMPLETE")
    print("===================================")
    print("")
    print("Output: index-upgraded.html")
    print("")
    print("Original index.html untouched.")
    print("")
    print("DO NOT DEPLOY UNTIL TESTED.")


if __name__ == "__main__":
    upgrade()