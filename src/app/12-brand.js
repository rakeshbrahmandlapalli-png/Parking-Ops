  // ── whose app this is ─────────────────────────────────────────────────────
  // One codebase, several parking companies. Each carries its own name, colour
  // and logo in companies.brand, and the page wears them the moment someone
  // signs in — a driver at Airport Parking Bay should never see the word
  // another company's name. Nothing here is per-company code; it is all data.
  var BRAND_KEY = "takeoff_brand";
  var PRODUCT = "Parking Ops";
  function brandName() {
    if (S.company) return String((S.company.brand && S.company.brand.short) || S.company.name || PRODUCT);
    try {
      var c = JSON.parse(localStorage.getItem(BRAND_KEY) || "null");
      if (c) return String((c.brand && c.brand.short) || c.name || PRODUCT);
    } catch (e) {}
    return PRODUCT;
  }
  // Light or dark (Cards look): the phone's own setting unless
  // this phone has picked one in the menu. Kept on the phone only.
  var MODE_KEY = "takeoff_mode", darkMq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function getMode() { try { return localStorage.getItem(MODE_KEY) || "auto"; } catch (e) { return "auto"; } }
  function applyMode() {
    var m = getMode(), dark = isCards() && (m === "dark" || (m === "auto" && !!darkMq && darkMq.matches));
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && isCards()) meta.setAttribute("content", dark ? "#0A111D" : getComputedStyle(document.documentElement).getPropertyValue(isPremium() ? "--pchrome" : "--chrome").trim() || "#0E3F7E");
  }
  function setMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (e) {} applyMode(); }
  if (darkMq && darkMq.addEventListener) darkMq.addEventListener("change", applyMode);
  function modeHtml() {
    if (!isCards()) return "";
    var m = getMode();
    return '<label>DISPLAY</label><div class="pseg mode">' + [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]].map(function (x) {
      return '<button type="button" data-mode="' + x[0] + '" class="' + (m === x[0] ? "on" : "") + '" aria-pressed="' + (m === x[0]) + '">' + x[1] + "</button>";
    }).join("") + '</div><p class="hint">Auto follows this phone\'s own light or dark setting.</p>';
  }
  function applyBrand(co) {
    var b = (co && co.brand) || {};
    applyYardColours(co);
    // Remembered on this phone so the NEXT sign-in screen already wears the
    // right name and colour. Without it an Airport Parking Bay driver opens
    // their app and is greeted by another company.
    try { if (co) localStorage.setItem(BRAND_KEY, JSON.stringify({ name: co.name, brand: co.brand || {} })); } catch (e) {}
    var name = String((co && co.name) || b.name || PRODUCT).trim();
    var short = String(b.short || name).trim();

    document.title = name;
    var t = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (t) t.setAttribute("content", short);

    // The look is the company's choice, in its brand (Clients → Edit → LOOK):
    // theme "pro" wears pro.css, "cards" cards.css, "premium" premium.css, "board" premium.css + board.css, none is Standard.
    // Cards and Premium share the card-per-car layout (isCards) but each wears
    // only its own stylesheet: html.cards → cards.css, html.premium → premium.css.
    // Premium Board is Premium plus board.css (html.premium + html.pboard).
    var board = b.theme === "board", premium = b.theme === "premium" || board, cards = b.theme === "cards", pro = b.theme === "pro" || cards || premium;
    document.documentElement.classList.toggle("pro", b.theme === "pro");
    document.documentElement.classList.toggle("cards", cards);
    document.documentElement.classList.toggle("premium", premium);
    document.documentElement.classList.toggle("pboard", board);
    // Standard with features: Standard plus the bottom bar (stdplus.css).
    // Operations is Standard with features plus its own chrome (ops.css): html.stdplus + html.ops.
    document.documentElement.classList.toggle("stdplus", b.theme === "stdplus" || b.theme === "ops");
    document.documentElement.classList.toggle("ops", b.theme === "ops");
    var mark = String(b.mark || short.charAt(0) || "P").slice(0, 2);
    // Only the wordmark and the board button. NOT ".brand" on its own: the
    Array.prototype.forEach.call(document.querySelectorAll("span.brand, .tobrand"), function (el) {
      var isGateScreen = el.closest(".gate") !== null;
      el.textContent = isGateScreen ? name : short;
      el.setAttribute("data-mark", mark);
      if (el.classList.contains("tobrand")) el.setAttribute("aria-label", name + " menu");
    });

    if (b.colour) {
      var root = document.documentElement.style;
      root.setProperty("--brand", b.colour);
      if (b.ink) root.setProperty("--brand-ink", b.ink);
      if (b.soft) root.setProperty("--brand-soft", b.soft);
      if (b.text) root.setProperty("--brand-text", b.text);
      // The pro look's bar: the brand's own dark colour, else its text colour.
      if (b.chrome || b.text) root.setProperty("--chrome", b.chrome || b.text);
      // Premium's header: only a colour the brand names for it, else navy.
      if (b.chrome) root.setProperty("--brand-chrome", b.chrome); else root.removeProperty("--brand-chrome");
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", pro ? (b.chrome || b.text || b.colour) : b.colour);
    }
    if (b.logo) {
      Array.prototype.forEach.call(document.querySelectorAll('link[rel="apple-touch-icon"], link[rel="icon"]'), function (l) { l.href = b.logo; });
    }
    applyMode();
  }

  // Wear the remembered brand immediately, before anyone signs in.
  try {
    var cached = JSON.parse(localStorage.getItem(BRAND_KEY) || "null");
    if (cached) applyBrand({ name: cached.name, brand: cached.brand });
  } catch (e) {}

  // Then ask the server whose app this actually is, by the address it is served
  // from or the company named in a #setup link. A phone that has never signed
  // in has nothing remembered, and nobody should meet another firm name on
  // their own sign-in screen. Only the name and colour come back.
  async function brandFromServer(key) {
    if (!key) return;
    try {
      var r = await sb.rpc("public_brand", { p_key: key });
      if (r && r.data && r.data.name) applyBrand({ name: r.data.name, brand: r.data.brand });
    } catch (e) {}
  }

  var R = window.TakeoffReader;
  function newImport(kind) { return { kind: kind || "drops", excelFile: null, pdfFile: null, stage: "pick", error: "", cutoff: kind === "picks" ? "00:00" : (S.company.drops_day_end || "06:00").slice(0, 5) }; }
  function shiftKey(dt, cutoff) {
    if (!dt) return "";
    if (!dt.time || cutoff === "00:00" || dt.time > cutoff) return dt.key;
    return addDaysKey(dt.key, -1);
  }
