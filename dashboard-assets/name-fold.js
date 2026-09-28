// One folding rule for every name search on the site — the browser half.
//
// "Jokic" and "Jokić" are the same search, and so are "oneal" and "O'Neal",
// "pj washington" and "P.J. Washington", "karl anthony towns" and
// "Karl-Anthony Towns". A reader on a phone keyboard cannot type an acute
// accent, and should not have to.
//
// The rule is one sentence: decompose the text, drop the accents, lowercase it,
// and keep only the letters a-z and the digits 0-9. Spaces, hyphens, periods
// and both kinds of apostrophe are dropped, so punctuation can never separate a
// reader from a player.
//
// `src/name_search.py` runs the same sentence in Python, and builds the SQL
// `translate()` pair from it, so the server, this file and the static site's
// shim fold a name to the same key. `tests/test_v11_search_and_weight.py`
// proves it over every player name in the corpus, both ways.
//
// A search keeps two characters a name does not: `%` and `_`. The search has
// always been a Postgres `ILIKE '%…%'`, so those two have always been
// wildcards, and folding must not quietly take a feature away.
//
// Written in the same UMD shape as team-directory.js, so the same file is a
// classic script in a page, a side-effect `import` in a module, and a
// `require()`-able core under node — which is what the parity proof drives.
(function nameFoldModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ValueContributedNameFold = api;
})(typeof globalThis === "undefined" ? this : globalThis, function buildNameFold() {
  "use strict";

  const COMBINING = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃰︠-︯]/gu;
  const NOT_PLAIN = /[^a-z0-9]/gu;
  const NOT_PLAIN_OR_WILDCARD = /[^a-z0-9%_]/gu;
  // Letters that carry their mark inside the glyph instead of beside it, so
  // decomposing them leaves them exactly as they were. `name_search.py` carries
  // the same eight pairs; without them a name would fold with a hole in it.
  const STRUCK_THROUGH = Object.freeze({
    "đ": "d", "ħ": "h", "ı": "i", "ł": "l", "ø": "o", "ŧ": "t", "ſ": "s", "ĸ": "k",
  });
  const STRUCK_THROUGH_PATTERN = /[đħıłøŧſĸ]/gu;

  function plain(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(COMBINING, "")
      .toLowerCase()
      .replace(STRUCK_THROUGH_PATTERN, (character) => STRUCK_THROUGH[character]);
  }

  /** The folded key of a name: lowercase ASCII letters and digits only. */
  function foldName(value) {
    return plain(value).replace(NOT_PLAIN, "");
  }

  /** The folded key of a search, keeping `%` and `_` as wildcards. */
  function foldSearch(value) {
    return plain(value).replace(NOT_PLAIN_OR_WILDCARD, "");
  }

  /**
   * Does one folded name contain another folded search?
   *
   * This is what `player_name ILIKE '%needle%'` answers, over folded keys:
   * `%` stands for any run of characters and `_` for one, and nothing else in
   * the needle is special, because folding has already removed everything that
   * could be.
   */
  function matchesName(value, needle) {
    const pattern = foldSearch(needle);
    if (!pattern) return true;
    const subject = foldName(value);
    if (!/[%_]/u.test(pattern)) return subject.includes(pattern);
    const expression = pattern
      .split("")
      .map((character) => (character === "%" ? "[\\s\\S]*" : (character === "_" ? "[\\s\\S]" : character)))
      .join("");
    return new RegExp(expression, "u").test(subject);
  }

  // A franchise can be searched by its abbreviation, its city or its nickname.
  // One needs help: the NBA's own name for the Clippers is "LA Clippers", so
  // the city a reader would type is not in the name. Kept in step with
  // `name_search.TEAM_CITY_ALIASES`.
  const TEAM_CITY_ALIASES = Object.freeze({
    1610612746: Object.freeze(["Los Angeles"]),
  });

  /** Does a franchise answer this search? Its id still matches exactly. */
  function matchesTeam({ teamId, name, abbreviation }, needle) {
    const trimmed = String(needle ?? "").trim();
    if (!trimmed) return true;
    if (trimmed === String(teamId)) return true;
    const aliases = TEAM_CITY_ALIASES[Number(teamId)] ?? [];
    return [name, abbreviation, ...aliases].some((part) => matchesName(part, trimmed));
  }

  return Object.freeze({
    foldName,
    foldSearch,
    matchesName,
    matchesTeam,
    TEAM_CITY_ALIASES,
  });
});
