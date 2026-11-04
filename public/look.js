// Each company wears one look (companies.brand.theme), and each look is its own
// stylesheet. A phone loads only its own look's sheets, not all eight: less to
// download and much less for the phone to read before it can draw.
// Runs in <head> where the look sheets go, so the sheets this phone needs (the
// look it wore last time) are written in place and the first screen already
// wears them. applyBrand (src/app/12-brand.js) calls TakeoffLook.use(theme)
// once the company is known; a sheet added then keeps the same order as before.
(function () {
  // Every look sheet in the order index.html always had them (the order the
  // rules relied on), and which ones each look wears.
  var ORDER = ["pro", "cards", "premium", "board", "stdplus", "ops", "ops-refined"];
  var WEARS = { pro: ["pro"], cards: ["cards"], premium: ["premium"], board: ["premium", "board"],
    stdplus: ["stdplus"], ops: ["stdplus", "ops"], "ops-refined": ["stdplus", "ops-refined"] };
  function sheets(theme) { return WEARS[theme] || []; }
  function href(name) { return "/" + name + ".css"; }
  function has(name) { return !!document.querySelector('link[data-look="' + name + '"]'); }

  // Add the theme's sheets that aren't on the page yet, each just before the next
  // look sheet in ORDER, else before the first shared sheet after the looks.
  // Until they arrive the page stays hidden (html.look-wait, app.css), at most 4 s,
  // so nobody sees the screen half in one look and half in another.
  var waiting = 0, waitCap = 0;
  function settled() {
    if (--waiting > 0) return;
    waiting = 0; clearTimeout(waitCap); document.documentElement.classList.remove("look-wait");
  }
  function use(theme) {
    sheets(theme).forEach(function (name) {
      if (has(name)) return;
      var l = document.createElement("link");
      l.rel = "stylesheet"; l.href = href(name); l.setAttribute("data-look", name);
      waiting++; l.onload = l.onerror = settled;
      document.documentElement.classList.add("look-wait");
      clearTimeout(waitCap); waitCap = setTimeout(function () { waiting = 1; settled(); }, 4000);
      var next = null;
      for (var i = ORDER.indexOf(name) + 1; i < ORDER.length && !next; i++) next = document.querySelector('link[data-look="' + ORDER[i] + '"]');
      next = next || document.getElementById("lookEnd");
      next.parentNode.insertBefore(l, next);
    });
  }
  window.TakeoffLook = { use: use, sheets: sheets, order: ORDER };

  var theme = "";
  try { var c = JSON.parse(localStorage.getItem("takeoff_brand") || "null"); theme = (c && c.brand && c.brand.theme) || ""; } catch (e) {}
  // Written by the parser, so the browser waits for them before the first paint.
  if (theme && document.readyState === "loading") {
    document.write(sheets(theme).map(function (name) { return '<link rel="stylesheet" href="' + href(name) + '" data-look="' + name + '">'; }).join(""));
  }
})();
