/*
 * Secuencia de imágenes vinculada al scroll, dibujada en un canvas.
 *
 * Modo sección (data-secuencia): el frame depende del avance de una sección.
 *   <section data-secuencia data-frames="assets/secuencia/frame-%03d.webp" data-total="157">
 *     <div class="sticky top-0 h-screen"><canvas></canvas></div>
 *   </section>
 *
 * Modo fondo (data-secuencia-fondo): un canvas fijo que cubre el viewport y
 * avanza con el scroll de toda la página. Sin scroll, el frame queda
 * congelado (el inicial, antes del primer scroll, es uno elegido a mano por
 * impacto visual; después, el último que se mostró) y lo único que se anima
 * es un fondo espacial de nebulosas, estrellas y estrellas fugaces detrás
 * de la nave.
 *   <canvas data-secuencia-fondo data-frames="..." data-total="157"></canvas>
 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  function pad(n) {
    return ('000' + n).slice(-3);
  }

  // Generador pseudoaleatorio determinista (mismo resultado siempre con la
  // misma semilla), para que las estrellas no salten de lugar en cada resize.
  function rand(seed) {
    var x = Math.sin(seed) * 43758.5453;
    return x - Math.floor(x);
  }

  // Crea el controlador de un canvas. `progress()` devuelve un valor 0..1.
  // `size()` ajusta el tamaño del canvas al contenedor.
  // `idle` (o null) activa, sin scroll, el frame congelado con fondo
  // espacial animado detrás. Ver `defaultIdle()` para su forma.
  function createPlayer(canvas, pattern, total, progress, size, idle) {
    var ctx = canvas.getContext('2d');
    var frames = new Array(total);
    var current = -1;
    var pos = 0;              // posición fraccionaria, lo que se dibuja (con inercia)
    var target = 0;           // posición hacia la que `pos` se acerca cada frame
    var lastScroll = -Infinity;
    var hasScrolled = false;  // false hasta el primer scroll real del usuario
    var parked = false;       // true mientras el frame está congelado (reposo)
    var idleFrame = 0;        // frame en el que quedó congelada la secuencia
    var last = 0;

    // Capa de la nave ya recortada y congelada (se recalcula solo cuando
    // cambia el frame o el tamaño del canvas, no en cada tick).
    var shipLayer = document.createElement('canvas');
    var shipCtx = shipLayer.getContext('2d');
    var shipLayerFor = -1; // qué frame tiene dibujado shipLayer actualmente

    // Estrellas y nebulosas fijas (posiciones y fases precalculadas una vez).
    var stars = null;
    var nebulae = null;
    var shootingStars = [];
    var shootingAcc = 0;

    function loadFrame(i) {
      if (i < 0 || i >= total) return null;
      if (!frames[i]) {
        var img = new Image();
        img.decoding = 'async';
        img.src = pattern.replace('%03d', pad(i + 1));
        // Si el frame llega después de que el scroll ya pidió dibujarlo, se dibuja al cargar.
        img.onload = function () { render(); };
        frames[i] = img;
      }
      return frames[i];
    }

    // Cubre el canvas manteniendo proporción (equivale a object-fit: cover).
    function draw(index, force) {
      if (index < 0) return;
      var img = loadFrame(index);
      if (!img || !img.complete || !img.naturalWidth) return;
      if (index === current && !force) return;
      current = index;
      var cw = canvas.width;
      var ch = canvas.height;
      var scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      var w = img.naturalWidth * scale;
      var h = img.naturalHeight * scale;
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
    }

    // --- Fondo espacial (lo único que se mueve durante el reposo) ---------

    function initSpace(cw, ch) {
      var n = idle.space.stars;
      stars = new Array(n);
      for (var i = 0; i < n; i++) {
        stars[i] = {
          x: rand(i * 12.9 + 1) ,
          y: rand(i * 78.2 + 7),
          r: 0.5 + rand(i * 3.7 + 2) * 1.6,
          phase: rand(i * 5.3 + 3) * Math.PI * 2,
          speed: 0.6 + rand(i * 9.1 + 4) * 1.6
        };
      }
      nebulae = idle.space.nebulae.map(function (neb, i) {
        return {
          x: neb.x, y: neb.y, r: neb.r, rgb: neb.rgb,
          phase: rand(i * 17.7 + 11) * Math.PI * 2,
          driftX: (rand(i * 23.1 + 13) - 0.5) * 0.04,
          driftY: (rand(i * 29.4 + 17) - 0.5) * 0.03
        };
      });
      shootingStars = [];
      shootingAcc = 0;
    }

    function spawnShootingStar(cw, ch) {
      var fromLeft = rand(Math.random() * 1000) > 0.5;
      var y0 = rand(Math.random() * 1000) * ch * 0.6;
      var len = (0.18 + rand(Math.random() * 1000) * 0.18) * cw;
      shootingStars.push({
        x: fromLeft ? -len : cw + len,
        y: y0,
        vx: (fromLeft ? 1 : -1) * cw * (0.9 + rand(Math.random() * 1000) * 0.6),
        vy: ch * (0.25 + rand(Math.random() * 1000) * 0.2),
        len: len,
        life: 0,
        maxLife: 0.7 + rand(Math.random() * 1000) * 0.3
      });
    }

    function drawSpace(now, dt, cw, ch) {
      if (!stars || stars.length !== idle.space.stars) initSpace(cw, ch);

      ctx.fillStyle = idle.space.bg;
      ctx.fillRect(0, 0, cw, ch);

      // Nebulosas: nubes de color grandes y suaves, a la deriva muy lenta.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < nebulae.length; i++) {
        var neb = nebulae[i];
        var t = now / 1000;
        var cx = (neb.x + Math.sin(t * 0.05 + neb.phase) * neb.driftX) * cw;
        var cy = (neb.y + Math.cos(t * 0.04 + neb.phase) * neb.driftY) * ch;
        var r = neb.r * Math.max(cw, ch) * (0.92 + 0.08 * Math.sin(t * 0.1 + neb.phase));
        var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, 'rgba(' + neb.rgb + ',0.5)');
        grad.addColorStop(0.5, 'rgba(' + neb.rgb + ',0.18)');
        grad.addColorStop(1, 'rgba(' + neb.rgb + ',0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Estrellas: puntos que titilan a su propio ritmo.
      ctx.save();
      for (var s = 0; s < stars.length; s++) {
        var st = stars[s];
        var tw = 0.45 + 0.55 * Math.max(0, Math.sin((now / 1000) * st.speed + st.phase));
        ctx.globalAlpha = tw;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(st.x * cw, st.y * ch, st.r * (cw / 1200), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Estrellas fugaces: aparecen de vez en cuando y cruzan parte del cielo.
      shootingAcc += dt;
      if (shootingAcc > idle.space.shootingEvery) {
        shootingAcc = 0;
        if (rand(now) > 0.35) spawnShootingStar(cw, ch);
      }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var k = shootingStars.length - 1; k >= 0; k--) {
        var sh = shootingStars[k];
        sh.life += dt;
        if (sh.life >= sh.maxLife) { shootingStars.splice(k, 1); continue; }
        sh.x += sh.vx * dt;
        sh.y += sh.vy * dt;
        var fade = 1 - sh.life / sh.maxLife;
        var dirX = sh.vx > 0 ? -1 : 1;
        var tailX = sh.x + dirX * sh.len;
        var tailY = sh.y - sh.vy * (sh.len / Math.abs(sh.vx || 1));
        var grad2 = ctx.createLinearGradient(sh.x, sh.y, tailX, tailY);
        grad2.addColorStop(0, 'rgba(255,255,255,' + fade + ')');
        grad2.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = grad2;
        ctx.lineWidth = Math.max(1, cw * 0.0016);
        ctx.beginPath();
        ctx.moveTo(sh.x, sh.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Recorta y guarda la nave del frame congelado, con los bordes
    // difuminados hacia afuera, para dejar ver el fondo espacial alrededor.
    // No hay una silueta real de la nave (los frames son imágenes planas sin
    // transparencia): se usa una elipse suave centrada en el canvas como
    // aproximación de dónde está la nave en la mayoría de los frames.
    function buildShipLayer(img, cw, ch) {
      shipLayer.width = cw;
      shipLayer.height = ch;
      shipCtx.clearRect(0, 0, cw, ch);
      var scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      var w = img.naturalWidth * scale;
      var h = img.naturalHeight * scale;
      shipCtx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);

      shipCtx.globalCompositeOperation = 'destination-in';
      var mx = cw * 0.5;
      var my = ch * idle.mask.cy;
      var rx = cw * idle.mask.rx;
      var ry = ch * idle.mask.ry;
      shipCtx.save();
      shipCtx.translate(mx, my);
      shipCtx.scale(rx, ry);
      var maskGrad = shipCtx.createRadialGradient(0, 0, 0, 0, 0, 1);
      maskGrad.addColorStop(0, 'rgba(0,0,0,1)');
      maskGrad.addColorStop(idle.mask.feather, 'rgba(0,0,0,1)');
      maskGrad.addColorStop(1, 'rgba(0,0,0,0)');
      shipCtx.fillStyle = maskGrad;
      shipCtx.beginPath();
      shipCtx.arc(0, 0, 1, 0, Math.PI * 2);
      shipCtx.fill();
      shipCtx.restore();
      shipCtx.globalCompositeOperation = 'source-over';

      shipLayerFor = idleFrame;
    }

    // Dibuja el fondo espacial animado y, encima, la nave congelada.
    function drawIdle(now, dt) {
      var img = loadFrame(idleFrame);
      if (!img || !img.complete || !img.naturalWidth) return;
      var cw = canvas.width;
      var ch = canvas.height;

      if (shipLayerFor !== idleFrame || shipLayer.width !== cw || shipLayer.height !== ch) {
        buildShipLayer(img, cw, ch);
      }

      drawSpace(now, dt, cw, ch);
      ctx.drawImage(shipLayer, 0, 0);
    }

    function render() {
      if (parked) { drawIdle(last || performance.now(), 0); return; }
      draw(Math.round(pos));
    }

    function resize() {
      size();
      current = -1;
      shipLayerFor = -1;
      render();
    }

    // Precarga el resto de frames en tiempo ocioso.
    function preload() {
      var i = 0;
      function next() {
        if (i >= total) return;
        loadFrame(i++);
        (window.requestIdleCallback || function (cb) { setTimeout(cb, 40); })(next);
      }
      next();
    }

    function onScroll() {
      lastScroll = performance.now();
      hasScrolled = true;
    }

    // Bucle: con scroll activo, el objetivo sigue al progreso y `pos` se le
    // acerca con inercia (nunca salta). En reposo el frame queda congelado
    // (el inicial, antes de cualquier scroll, es el elegido a mano; luego,
    // el último mostrado) y solo se anima el fondo espacial detrás, así que
    // al reanudar el scroll la animación continúa desde ahí, sin reiniciarse.
    function tick(now) {
      var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      var scrolling = now - lastScroll < 250;

      if (scrolling || !idle) {
        // Al salir del reposo, fuerza un redibujado limpio del frame normal.
        if (parked) { current = -1; }
        parked = false;
        target = progress() * (total - 1);
        pos = idle ? pos + (target - pos) * (1 - Math.exp(-dt * 8)) : target;
        draw(Math.round(pos));
      } else {
        if (!parked) {
          idleFrame = (!hasScrolled && idle.initialFrame != null)
            ? Math.max(0, Math.min(total - 1, idle.initialFrame))
            : Math.round(pos);
          parked = true;
        }
        drawIdle(now, dt);
      }
      requestAnimationFrame(tick);
    }

    pos = target = progress() * (total - 1);
    loadFrame(0).addEventListener('load', function () { render(); });
    resize();

    if (reduceMotion) {
      draw(Math.round(pos), true);
      return;
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', resize);
    preload();
    requestAnimationFrame(tick);
  }

  // Configuración por defecto del modo fondo en reposo.
  // - initialFrame: frame que se muestra en el primer reposo, antes de que
  //   el usuario haga scroll por primera vez (índice 0-based; 29 = frame_030,
  //   la nave con el anillo de energía encendido).
  // - mask: elipse suave (fracciones del canvas) que aproxima dónde está la
  //   nave, para dejar ver el fondo espacial alrededor. No seguimos la
  //   silueta real cuadro a cuadro.
  // - space: fondo animado (color base, nebulosas con posición/color/tamaño
  //   en fracciones del canvas, cantidad de estrellas y frecuencia de
  //   estrellas fugaces).
  function defaultIdle() {
    return {
      initialFrame: 29,
      mask: { cy: 0.5, rx: 0.5, ry: 0.42, feather: 0.55 },
      space: {
        bg: '#060814',
        stars: 140,
        shootingEvery: 1.4,
        nebulae: [
          { x: 0.22, y: 0.35, r: 0.42, rgb: '94,58,168' },
          { x: 0.78, y: 0.62, r: 0.38, rgb: '244,182,63' },
          { x: 0.55, y: 0.18, r: 0.3, rgb: '74,108,247' }
        ]
      }
    };
  }

  function initSeccion(section) {
    var canvas = section.querySelector('canvas');
    if (!canvas) return;
    var total = parseInt(section.getAttribute('data-total'), 10) || 1;

    function progress() {
      var rect = section.getBoundingClientRect();
      var scrollable = section.offsetHeight - window.innerHeight;
      if (scrollable <= 0) return 0;
      return Math.min(1, Math.max(0, -rect.top / scrollable));
    }

    function size() {
      var rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }

    createPlayer(canvas, section.getAttribute('data-frames'), total, progress, size, null);
  }

  function initFondo(canvas) {
    var total = parseInt(canvas.getAttribute('data-total'), 10) || 1;

    // Avance de toda la página: 0 al inicio, 1 al final.
    function progress() {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    }

    function size() {
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
    }

    var idle = canvas.getAttribute('data-idle') === 'off' ? null : defaultIdle();

    createPlayer(canvas, canvas.getAttribute('data-frames'), total, progress, size, idle);
  }

  function boot() {
    var secciones = document.querySelectorAll('[data-secuencia]');
    for (var i = 0; i < secciones.length; i++) initSeccion(secciones[i]);

    var fondos = document.querySelectorAll('[data-secuencia-fondo]');
    for (var j = 0; j < fondos.length; j++) initFondo(fondos[j]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
