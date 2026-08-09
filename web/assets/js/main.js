/* ANDE · Batumi — sdílené skripty (mobilní menu + brána pro hosty) */
(function () {
  "use strict";

  /* ---------- mobilní menu ---------- */
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.querySelector(".nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  /* ---------- brána pro hosty ----------
     Heslo není v kódu — je uložen pouze jeho SHA-256 otisk.
     POZOR: jde o lehkou ochranu pro fázi kostry. Před nasazením
     skutečných údajů (Wi-Fi hesla apod.) přepnout na Cloudflare
     Access nebo StatiCrypt — viz README.md.
     Změna hesla: echo -n "NoveHeslo" | sha256sum               */
  var GUEST_HASH = "9c066e5f3e1a01eae16b59b9379204cbe2b33cabc7d352eee0102b89689b5be2";

  var gate = document.getElementById("gate");
  var tpl = document.getElementById("guest-template");
  var area = document.getElementById("guest-area");

  function unlock() {
    if (!tpl || !area) return;
    area.appendChild(tpl.content.cloneNode(true));
    area.hidden = false;
    if (gate) gate.hidden = true;
  }

  async function sha256Hex(text) {
    var data = new TextEncoder().encode(text);
    var buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf))
      .map(function (b) { return b.toString(16).padStart(2, "0"); })
      .join("");
  }

  if (gate) {
    if (sessionStorage.getItem("ande-guest") === "1") {
      unlock();
    }
    gate.addEventListener("submit", async function (e) {
      e.preventDefault();
      var input = gate.querySelector("input[type=password]");
      var error = gate.querySelector(".gate-error");
      if (!input) return;
      var hash = await sha256Hex(input.value.trim());
      if (hash === GUEST_HASH) {
        sessionStorage.setItem("ande-guest", "1");
        unlock();
      } else if (error) {
        error.hidden = false;
        input.value = "";
        input.focus();
      }
    });
  }
})();
