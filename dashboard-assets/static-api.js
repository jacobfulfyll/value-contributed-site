(() => {
  const nativeFetch = window.fetch.bind(window);
  const scriptUrl = document.currentScript.src;
  const siteRoot = new URL("../", scriptUrl);

  function slug(value) {
    return String(value)
      .toLocaleLowerCase("en-US")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  async function staticJson(path, init) {
    const response = await nativeFetch(new URL(`data/${path}`, siteRoot), init);
    if (!response.ok) return response;
    return new Response(await response.text(), {
      status: response.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  function jsonResponse(payload) {
    return Promise.resolve(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }));
  }

  function compareValues(left, right, direction) {
    const leftMissing = left === null || left === undefined;
    const rightMissing = right === null || right === undefined;
    if (leftMissing || rightMissing) {
      if (leftMissing && rightMissing) return 0;
      return leftMissing ? 1 : -1;
    }
    const comparison = typeof left === "string"
      ? left.localeCompare(right)
      : Number(left) - Number(right);
    return direction === "asc" ? comparison : -comparison;
  }

  async function rankingsResponse(url, init) {
    const season = url.searchParams.get("season") || "All Seasons";
    const phase = url.searchParams.get("phase") || "All";
    const metric = url.searchParams.get("metric") || "value_contributed";
    const requestedSort = url.searchParams.get("sort_by") || "value_contributed";
    const sortBy = requestedSort === "selected_metric" ? metric : requestedSort;
    const sortDirection = url.searchParams.get("sort_direction") === "asc"
      ? "asc"
      : "desc";
    const search = (url.searchParams.get("search") || "")
      .trim()
      .toLocaleLowerCase();
    const limit = Math.max(1, Math.min(250, Number(url.searchParams.get("limit")) || 50));
    const response = await staticJson(
      `rankings/${slug(season)}--${slug(phase)}.json`,
      init,
    );
    if (!response.ok) return response;
    const snapshot = await response.json();
    const rankedRows = [...snapshot.rows].sort((left, right) => {
      const comparison = compareValues(left[sortBy], right[sortBy], sortDirection);
      return comparison || Number(left.player_id) - Number(right.player_id);
    });
    rankedRows.forEach((row, index) => { row.rank = index + 1; });
    const rows = rankedRows
      .filter((row) => !search || row.player_name.toLocaleLowerCase().includes(search))
      .slice(0, limit);
    return jsonResponse({
      ...snapshot,
      metric,
      sort_by: requestedSort,
      sort_direction: sortDirection,
      rows,
    });
  }

  async function topGamesResponse(url, init) {
    const season = url.searchParams.get("season") || "All Seasons";
    const phase = url.searchParams.get("phase") || "All";
    const outcome = url.searchParams.get("outcome") || "Both";
    const limit = Math.max(1, Math.min(250, Number(url.searchParams.get("limit")) || 25));
    const response = await staticJson(
      `top-games/${slug(season)}--${slug(phase)}--${slug(outcome)}.json`,
      init,
    );
    if (!response.ok) return response;
    const snapshot = await response.json();
    return jsonResponse({
      ...snapshot,
      rows: snapshot.rows.slice(0, limit),
    });
  }

  window.fetch = async (input, init = {}) => {
    const requestUrl = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
      window.location.href,
    );
    const path = requestUrl.pathname;
    if (path.endsWith("/api/rankings/options")) {
      return staticJson("options.json", init);
    }
    if (path.endsWith("/api/methodology")) {
      return staticJson("methodology.json", init);
    }
    if (path.endsWith("/api/rankings/top-games")) {
      return topGamesResponse(requestUrl, init);
    }
    if (path.endsWith("/api/rankings/rolling-trends")) {
      const phase = requestUrl.searchParams.get("phase") || "All";
      const years = requestUrl.searchParams.get("window_years") || "3";
      return staticJson(`rolling-trends/${slug(phase)}--${years}.json`, init);
    }
    if (path.endsWith("/api/rankings/postseason-lift-trends")) {
      const years = requestUrl.searchParams.get("window_years") || "3";
      return staticJson(`postseason-lift-trends/${years}.json`, init);
    }
    if (path.endsWith("/api/rankings")) {
      return rankingsResponse(requestUrl, init);
    }
    return nativeFetch(input, init);
  };
})();
