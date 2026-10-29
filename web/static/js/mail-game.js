/* Конверт-догонялки на время распознавания накладной.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html.

   Скан читается до минуты и дольше. Пока ждём, вместо крутилки сидит тот же
   конверт с крылышками, что на странице 404: поводили мышкой — он взлетает и
   гоняется за курсором, догнал — «поймал». Мышь замерла на 3 секунды —
   возвращается на место. Рисуется поверх страницы (svg на весь экран, клики
   сквозь него проходят) и прячется, когда раздел накладных не на экране.
   При «уменьшить движение» в системе не запускается — остаётся крутилка. */
"use strict";

var mailGame = (function(){
  var NS = "http://www.w3.org/2000/svg";
  var svg = null, homeEl = null, onScore = null, raf = 0, lastT = null;
  var root, flapEl, mouthEl, wingL, wingR, pupils, bitsG;
  var mouse = null, caught = 0, pos, vx, vy, tilt, chomp, cooldown, openS;

  function mk(tag, attrs, parent){
    var e = document.createElementNS(NS, tag);
    for(var k in attrs) e.setAttribute(k, attrs[k]);
    if(parent) parent.appendChild(e);
    return e;
  }
  function f(n){ return n.toFixed(1); }
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, k){ return a + (b - a) * k; }
  function dist(x, y){ return Math.sqrt(x * x + y * y); }
  function track(e){ mouse = {x:e.clientX, y:e.clientY, t:performance.now() / 1000}; }
  function home(){
    var r = homeEl.getBoundingClientRect();
    return {x:r.left + r.width / 2, y:r.top + r.height / 2};
  }
  function scale(){ return window.innerWidth < 520 ? 1 : 1.25; }

  function burst(x, y){
    for(var i = 0; i < 8; i++){
      var e = mk("rect", {width:4, height:4, x:-2, y:-2, "class":"mg-bit"}, bitsG);
      var a = Math.random() * Math.PI * 2, v = 50 + Math.random() * 70;
      e._d = {x:x, y:y, vx:Math.cos(a) * v, vy:Math.sin(a) * v - 50, life:0, rot:Math.random() * 360};
    }
  }
  function updateBits(dt){
    Array.prototype.slice.call(bitsG.childNodes).forEach(function(e){
      var d = e._d;
      d.life += dt; d.vy += 240 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.rot += 400 * dt;
      e.setAttribute("transform", "translate(" + f(d.x) + " " + f(d.y) + ") rotate(" + f(d.rot) + ")");
      e.style.opacity = clamp(1 - d.life / 0.9, 0, 1).toFixed(2);
      if(d.life > 0.9) bitsG.removeChild(e);
    });
  }

  function build(){
    bitsG = mk("g", {}, svg);
    root = mk("g", {}, svg);
    pupils = [];
    wingL = mk("path", {"class":"mg-wing"}, root);
    wingR = mk("path", {"class":"mg-wing"}, root);
    mouthEl = mk("path", {"class":"mg-mouth", d:"M-22 -14 L22 -14 L0 3Z"}, root);
    mk("rect", {"class":"mg-paper", x:-22, y:-14, width:44, height:28, rx:3}, root);
    mk("path", {"class":"mg-line", d:"M-21 13 L-4 1 M21 13 L4 1"}, root);
    mk("rect", {"class":"mg-stamp", x:11, y:3, width:8, height:8, rx:1}, root);
    mk("text", {"class":"mg-stamp-t", x:15, y:8.6}, root).textContent = "IT";
    [-7, 7].forEach(function(ex){
      mk("circle", {"class":"mg-eye", cx:ex, cy:3, r:4}, root);
      pupils.push(mk("circle", {"class":"mg-pupil", cx:ex, cy:3, r:1.9}, root));
    });
    flapEl = mk("path", {"class":"mg-paper"}, root);
  }

  function update(dt, now){
    var hunting = !!(mouse && now - mouse.t < 3);
    var H = home(), sc = scale();
    var tx = hunting ? mouse.x : H.x, ty = hunting ? mouse.y : H.y;
    /* летит мягко, как на пружинке */
    var k = hunting ? 7 : 5, damp = 4.2;
    vx += ((tx - pos.x) * k - vx * damp) * dt;
    vy += ((ty - pos.y) * k - vy * damp) * dt;
    var sp = dist(vx, vy);
    if(sp > 320){ vx *= 320 / sp; vy *= 320 / sp; sp = 320; }
    pos.x = clamp(pos.x + vx * dt, 30, window.innerWidth - 30);
    pos.y = clamp(pos.y + vy * dt, 30, window.innerHeight - 30);
    var d = dist(tx - pos.x, ty - pos.y);
    var resting = !hunting && d < 6 && sp < 15, flying = !resting;
    tilt = lerp(tilt, clamp(vx * 0.07, -22, 22), Math.min(1, dt * 6));
    var bob = flying ? Math.sin(now * 6) * 3 : 0;
    /* крылышки машут в полёте и складываются, когда сидит */
    var flap = flying ? Math.sin(now * (hunting ? 20 : 12)) : -1;
    var wy = -10 - flap * 12, wy2 = -2 - flap * 6;
    wingL.setAttribute("d", "M-20 -4 L-40 " + f(wy) + " L-32 " + f(wy2 + 6) + " Z");
    wingR.setAttribute("d", "M20 -4 L40 " + f(wy) + " L32 " + f(wy2 + 6) + " Z");
    wingL.style.display = wingR.style.display = resting ? "none" : "";
    cooldown -= dt;
    if(hunting && cooldown <= 0 && d < 18 * sc){
      cooldown = 1; chomp = 0; caught++;
      burst(mouse.x, mouse.y);
      vy -= 120;
      if(onScore) onScore(caught);
    }
    /* клапан — это рот: открывается, когда курсор близко */
    var target = hunting ? clamp(1.2 - d / 130, 0, 1) : 0;
    if(chomp >= 0){ chomp += dt; target = chomp < 0.12 ? 1 : 0; if(chomp > 0.6) chomp = -1; }
    openS = lerp(openS, target, Math.min(1, dt * (chomp >= 0 ? 30 : 8)));
    flapEl.setAttribute("d", "M-22 -14 L22 -14 L0 " + f(lerp(3, -34, openS)) + "Z");
    mouthEl.style.opacity = openS > 0.15 ? 1 : 0;
    var look = mouse || {x:pos.x, y:pos.y + 100}, la = Math.atan2(look.y - pos.y, look.x - pos.x);
    pupils.forEach(function(p, i){
      p.setAttribute("cx", f((i ? 7 : -7) + Math.cos(la) * 1.6));
      p.setAttribute("cy", f(3 + Math.sin(la) * 1.6));
    });
    var shake = chomp >= 0 ? Math.sin(chomp * 50) * 5 : 0;
    root.setAttribute("transform", "translate(" + f(pos.x) + " " + f(pos.y + bob) + ") rotate(" +
      f(tilt + shake) + ") scale(" + sc + ")");
  }

  function tick(ms){
    if(!svg) return;
    var now = ms / 1000, dt = lastT === null ? 0 : Math.min(0.05, now - lastT);
    lastT = now;
    /* ушли в другой раздел, пока сканируется, — конверт не летает поверх чужого экрана */
    var shown = homeEl.offsetParent !== null;
    svg.style.display = shown ? "" : "none";
    if(shown){ update(dt, now); updateBits(dt); }
    raf = requestAnimationFrame(tick);
  }

  /* el — где конверт сидит, пока мышь не двигается; score(n) — поймал n-й раз.
     false — не запущен (уменьшение движения в системе). */
  function start(el, score){
    stop();
    if(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    homeEl = el; onScore = score; caught = 0; mouse = null; lastT = null;
    svg = mk("svg", {"class":"mailgame", "aria-hidden":"true"});
    document.body.appendChild(svg);
    build();
    var H = home();
    pos = {x:H.x, y:H.y}; vx = vy = tilt = 0; chomp = -1; cooldown = 0; openS = 0;
    window.addEventListener("pointermove", track);
    window.addEventListener("pointerdown", track);
    raf = requestAnimationFrame(tick);
    return true;
  }
  function stop(){
    if(raf) cancelAnimationFrame(raf);
    raf = 0;
    window.removeEventListener("pointermove", track);
    window.removeEventListener("pointerdown", track);
    if(svg && svg.parentNode) svg.parentNode.removeChild(svg);
    svg = null;
  }
  return {start:start, stop:stop};
})();
