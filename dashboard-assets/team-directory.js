// One shared NBA team directory for every dashboard page.
//
// Teams are shown as their three-letter abbreviation wherever a team appears as
// visible text; the full franchise name is only used for tooltips and heroes.
// A numeric NBA team id is never a label, so an unknown id renders as an em
// dash instead of leaking the number into the page.
//
// The file is written in the same UMD shape as static-api.js so both the
// classic scripts (app.js) and the ES modules (entities.js, compare.js,
// seasons.js, experiments/entity-source-adapter.js) can use it: modules import
// it for its side effect and read `globalThis.ValueContributedTeamDirectory`.
(function teamDirectoryModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ValueContributedTeamDirectory = api;
})(typeof globalThis === "undefined" ? this : globalThis, function buildTeamDirectory() {
  "use strict";

  const UNKNOWN_TEAM = "—";
  const TEAM_DIRECTORY = Object.freeze({
    1610612737: Object.freeze({ abbreviation: "ATL", name: "Atlanta Hawks" }),
    1610612738: Object.freeze({ abbreviation: "BOS", name: "Boston Celtics" }),
    1610612739: Object.freeze({ abbreviation: "CLE", name: "Cleveland Cavaliers" }),
    1610612740: Object.freeze({ abbreviation: "NOP", name: "New Orleans Pelicans" }),
    1610612741: Object.freeze({ abbreviation: "CHI", name: "Chicago Bulls" }),
    1610612742: Object.freeze({ abbreviation: "DAL", name: "Dallas Mavericks" }),
    1610612743: Object.freeze({ abbreviation: "DEN", name: "Denver Nuggets" }),
    1610612744: Object.freeze({ abbreviation: "GSW", name: "Golden State Warriors" }),
    1610612745: Object.freeze({ abbreviation: "HOU", name: "Houston Rockets" }),
    1610612746: Object.freeze({ abbreviation: "LAC", name: "LA Clippers" }),
    1610612747: Object.freeze({ abbreviation: "LAL", name: "Los Angeles Lakers" }),
    1610612748: Object.freeze({ abbreviation: "MIA", name: "Miami Heat" }),
    1610612749: Object.freeze({ abbreviation: "MIL", name: "Milwaukee Bucks" }),
    1610612750: Object.freeze({ abbreviation: "MIN", name: "Minnesota Timberwolves" }),
    1610612751: Object.freeze({ abbreviation: "BKN", name: "Brooklyn Nets" }),
    1610612752: Object.freeze({ abbreviation: "NYK", name: "New York Knicks" }),
    1610612753: Object.freeze({ abbreviation: "ORL", name: "Orlando Magic" }),
    1610612754: Object.freeze({ abbreviation: "IND", name: "Indiana Pacers" }),
    1610612755: Object.freeze({ abbreviation: "PHI", name: "Philadelphia 76ers" }),
    1610612756: Object.freeze({ abbreviation: "PHX", name: "Phoenix Suns" }),
    1610612757: Object.freeze({ abbreviation: "POR", name: "Portland Trail Blazers" }),
    1610612758: Object.freeze({ abbreviation: "SAC", name: "Sacramento Kings" }),
    1610612759: Object.freeze({ abbreviation: "SAS", name: "San Antonio Spurs" }),
    1610612760: Object.freeze({ abbreviation: "OKC", name: "Oklahoma City Thunder" }),
    1610612761: Object.freeze({ abbreviation: "TOR", name: "Toronto Raptors" }),
    1610612762: Object.freeze({ abbreviation: "UTA", name: "Utah Jazz" }),
    1610612763: Object.freeze({ abbreviation: "MEM", name: "Memphis Grizzlies" }),
    1610612764: Object.freeze({ abbreviation: "WAS", name: "Washington Wizards" }),
    1610612765: Object.freeze({ abbreviation: "DET", name: "Detroit Pistons" }),
    1610612766: Object.freeze({ abbreviation: "CHA", name: "Charlotte Hornets" }),
  });

  // A bare number is an identifier, never a label: payloads that repeat the
  // team id in an abbreviation field are treated as if they carried nothing.
  function label(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (!text || text === UNKNOWN_TEAM || /^\d+$/.test(text)) return null;
    return text;
  }

  function teamEntry(teamId) {
    if (teamId === null || teamId === undefined) return null;
    const key = String(teamId).trim();
    return /^\d+$/.test(key) ? TEAM_DIRECTORY[key] ?? null : null;
  }

  function teamAbbreviation(teamId, supplied = null) {
    return label(supplied) ?? teamEntry(teamId)?.abbreviation ?? null;
  }

  function teamName(teamId, supplied = null) {
    return label(supplied) ?? teamEntry(teamId)?.name ?? null;
  }

  // The label that is safe to print anywhere a team appears as visible text.
  function teamLabel(teamId, supplied = null) {
    return teamAbbreviation(teamId, supplied) ?? UNKNOWN_TEAM;
  }

  // The team shape every panel renders: abbreviation for visible text, full
  // name for tooltips and heroes, numeric id only for links and keys.
  function teamRecord(teamId, { abbreviation = null, name = null } = {}) {
    const numeric = Number(teamId);
    const id = Number.isFinite(numeric) ? numeric : null;
    const short = teamAbbreviation(teamId, abbreviation);
    const full = teamName(teamId, name) ?? short;
    return {
      id,
      team_id: id,
      abbreviation: short ?? UNKNOWN_TEAM,
      name: full ?? UNKNOWN_TEAM,
      team_name: full ?? UNKNOWN_TEAM,
    };
  }

  // Team ids and their abbreviations arrive as parallel lists on the V10 and
  // V11 ranking rows; either list may be absent.
  function teamRecords(teamIds = [], abbreviations = []) {
    return (teamIds ?? []).map((teamId, index) => teamRecord(teamId, {
      abbreviation: (abbreviations ?? [])[index] ?? null,
    }));
  }

  return Object.freeze({
    TEAM_DIRECTORY,
    UNKNOWN_TEAM,
    teamCount: Object.keys(TEAM_DIRECTORY).length,
    teamEntry,
    teamAbbreviation,
    teamName,
    teamLabel,
    teamRecord,
    teamRecords,
  });
});
