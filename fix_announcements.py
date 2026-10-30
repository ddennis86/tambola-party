from pathlib import Path
import sys
from datetime import datetime

SOURCE = Path("index-upgraded.html")

if not SOURCE.exists():
    sys.exit("ERROR: index-upgraded.html not found. Open the folder that contains index-upgraded.html.")

html = SOURCE.read_text(encoding="utf-8")

print("Reading index-upgraded.html...")

# Backup first - never modify without backup
stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
backup = Path(f"index-upgraded.backup-{stamp}.html")
backup.write_text(html, encoding="utf-8")
print(f"Backup created: {backup.name}")

def replace_once(old, new, label):
    global html
    count = html.count(old)
    if count == 0:
        sys.exit(f"ERROR in {label}: expected text not found. Stopping without changes.")
    if count != 1:
        sys.exit(f"ERROR in {label}: found {count} matches, expected 1. Stopping without changes.")
    html = html.replace(old, new, 1)
    print(f"OK - {label}")

# 1. Add player announcement HTML if missing
if "playerAnnouncementBox" not in html:
    old_tickets = """  <div class="card">\n\n    <h2>🎟️ My Tambola Tickets</h2>"""
    new_tickets = """  <div class="card center">\n\n    <h2>📢 Fun Announcements</h2>\n\n    <div id="playerAnnouncementBox">\n      <div id="playerAnnouncementText">Waiting for announcements...</div>\n      <div id="playerAnnouncementList"></div>\n    </div>\n\n  </div>\n\n  <div class="card">\n\n    <h2>🎟️ My Tambola Tickets</h2>"""
    replace_once(old_tickets, new_tickets, "Added player announcement box")
else:
    print("OK - Player announcement box already exists, skipping")

# 2. Add CSS if missing
if "#playerAnnouncementBox" not in html or "#playerAnnouncementText" not in html.split("</style>")[0][-5000:]:
    # Check if our CSS already added
    if "player-announcement-item" not in html:
        old_style = "</style>"
        new_style = """/* Player fun announcements */
#playerAnnouncementBox {
  background: #fff3cd;
  color: #664d03;
  border-radius: 12px;
  padding: 14px;
  margin: 8px 0;
}
#playerAnnouncementText {
  font-size: 19px;
  font-weight: bold;
  line-height: 1.5;
}
.player-announcement-item {
  background: white;
  border-radius: 8px;
  padding: 8px;
  margin: 6px 0;
  font-size: 14px;
  color: #333;
  text-align: left;
}
</style>"""
        replace_once(old_style, new_style, "Added announcement styles")
    else:
        print("OK - Announcement styles already exist")
else:
    print("OK - Announcement styles already exist")

# 3. Add display helper function if missing
if "function renderPlayerAnnouncements" not in html:
    old_func = "async function checkGameAnnouncements() {"
    new_func = """function renderPlayerAnnouncements(newestFirst) {
  const box = element("playerAnnouncementBox");
  const textEl = element("playerAnnouncementText");
  const listEl = element("playerAnnouncementList");
  if (!box || !textEl) return;
  const items = Array.isArray(newestFirst) ? newestFirst : [];
  if (!items.length) {
    textEl.textContent = "Waiting for announcements...";
    if (listEl) listEl.innerHTML = "";
    return;
  }
  const latest = items[0] || {};
  textEl.textContent = "\\uD83D\\uDCE3 " + (latest.phrase || "New announcement!");
  if (listEl) {
    listEl.innerHTML = "";
    items.slice(0, 5).forEach(function(item) {
      const div = document.createElement("div");
      div.className = "player-announcement-item";
      div.textContent = "\\uD83D\\uDCE3 " + (item.phrase || "");
      listEl.appendChild(div);
    });
  }
}

async function checkGameAnnouncements() {"""
    replace_once(old_func, new_func, "Added display helper")
else:
    print("OK - Display helper already exists")

# 4. Make checkGameAnnouncements update the screen
old_block = """    if (
      !game ||
      game.id !== gameId ||
      currentView !== "playerPanel"
    ) {
      return;
    }

    const announcements = (data || [])
      .slice()
      .reverse();"""

if old_block in html and "renderPlayerAnnouncements((data" not in html:
    new_block = """    if (
      !game ||
      game.id !== gameId ||
      currentView !== "playerPanel"
    ) {
      return;
    }

    try {
      renderPlayerAnnouncements((data || []).slice());
    } catch (displayError) {
      console.warn("Announcement display failed:", displayError);
    }

    const announcements = (data || [])
      .slice()
      .reverse();"""
    replace_once(old_block, new_block, "Connected announcements to display")
else:
    if "renderPlayerAnnouncements((data" in html:
        print("OK - Display already connected")
    else:
        sys.exit("ERROR: Could not find announcement fetch block. Stopping.")

# 5. Add fallback polling every 3 seconds if missing
if "_tambolaAnnouncementTimer" not in html:
    old_init = "// =====================================\n// INITIALISE\n// ====================================="
    new_init = """if (!window._tambolaAnnouncementTimer) {
  window._tambolaAnnouncementTimer = setInterval(function() {
    try {
      if (typeof currentView !== "undefined" && currentView === "playerPanel") {
        if (typeof checkGameAnnouncements === "function") {
          checkGameAnnouncements();
        }
      }
    } catch (e) {}
  }, 3000);
}

// =====================================
// INITIALISE
// ====================================="""
    replace_once(old_init, new_init, "Added 3-second announcement refresh")
else:
    print("OK - Auto-refresh already exists")

SOURCE.write_text(html, encoding="utf-8")

print()
print("========================================")
print(" SUCCESS - ANNOUNCEMENT FIX APPLIED")
print("========================================")
print(f"Updated: {SOURCE.name}")
print(f"Backup: {backup.name}")
print("Original live index.html was NOT touched.")
print()