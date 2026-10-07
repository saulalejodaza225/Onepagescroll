/*
 * Secuencia de imágenes vinculada al scroll, dibujada en un canvas.
 *
 * Modo sección (data-secuencia): el frame depende del avance de una sección.
 *   <section data-secuencia data-frames="assets/secuencia/frame-%03d.webp" data-total="157">
 *     <div class="sticky top-0 h-screen"><canvas></canvas></div>
 *   </section>
 *
 * Modo fondo (data-secuencia-fondo): un canvas fijo que cubre el viewport y
 * avanza con el scroll de toda la página. Sin scroll, el frame se congela
 * en el último que se mostró y se decora con luces pulsantes y partículas
 * dibujadas aparte, en vez de seguir moviendo la secuencia.
 *   <canvas data-secuencia-fondo data-frames="..." data-total="157"></canvas>
 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  function pad(n) {
    return ('000' + n).slice(-3);
  }

  // Crea el controlador de un canvas. `progress()` devuelve un valor 0..1.
  // `size()` ajusta el tamaño del canvas al contenedor.
  // `idle` (o null) describe las luces/partículas que decoran el frame
  // congelado cuando no hay scroll. Ver `defaultIdle()` para su forma.
  function createPlayer(canvas, pattern, total, progress, size, idle) {
    var ctx = canvas.getContext('2d');
    var frames = new Array(total);
    var current = -1;
    var pos = 0;              // posición fraccionaria, lo que se dibuja (con inercia)
    var target = 0;           // posición hacia la que `pos` se acerca cada frame
    var lastScroll = -Infinity;
    var parked = false;       // true mientras el frame está congelado (reposo)
    var idleFrame = 0;        // frame en el que quedó congelada la secuencia
    var particles = [];
    var spawnAcc = 0;
    var last = 0;

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

    // Reparte nuevas partículas desde los puntos de luz, a un ritmo constante.
    function spawnParticles(dt, cw, ch) {
      spawnAcc += dt;
      var rate = 9; // partículas por segundo, repartidas entre todas las luces
      var n = Math.floor(spawnAcc * rate);
      if (n <= 0) return;
      spawnAcc -= n / rate;
      for (var k = 0; k < n; k++) {
        var L = idle.lights[(Math.random() * idle.lights.length) | 0];
        var cx = L.x * cw;
        var cy = L.y * ch;
        var jitter = Math.min(cw, ch) * 0.015;
        particles.push({
          x: cx + (Math.random() - 0.5) * jitter * 2,
          y: cy + (Math.random() - 0.5) * jitter * 2,
          vx: (Math.random() - 0.5) * 0.02 * cw,
          vy: -(0.03 + Math.random() * 0.04) * ch,
          life: 0,
          maxLife: 0.9 + Math.random() * 0.8,
          size: (1.4 + Math.random() * 2.2) * (cw / 900),
          rgb: L.rgb
        });
      }
      if (particles.length > 160) particles.splice(0, particles.length - 160);
    }

    // Envejece y dibuja las partículas vivas (aditivo, como chispas luminosas).
    function drawParticles(dt) {
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.life += dt;
        if (p.life >= p.maxLife) { particles.splice(i, 1); continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        var t = p.life / p.maxLife;
        var alpha = (1 - t) * 0.85;
        var r = p.size * (1 - t * 0.3) * 2.4;
        var grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        grad.addColorStop(0, 'rgba(' + p.rgb + ',' + alpha + ')');
        grad.addColorStop(1, 'rgba(' + p.rgb + ',0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Dibuja el frame congelado y, encima, las luces pulsantes y las partículas.
    function drawIdle(now, dt) {
      draw(idleFrame, true);
      var cw = canvas.width;
      var ch = canvas.height;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < idle.lights.length; i++) {
        var L = idle.lights[i];
        var pulse = 0.6 + 0.4 * Math.sin((now / 1000) * (2 * Math.PI / L.period) + i * 1.3);
        var cx = L.x * cw;
        var cy = L.y * ch;
        var r = L.r * Math.min(cw, ch) * (0.85 + 0.15 * pulse);
        var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, 'rgba(' + L.rgb + ',' + (0.55 * pulse) + ')');
        grad.addColorStop(1, 'rgba(' + L.rgb + ',0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      spawnParticles(dt, cw, ch);
      drawParticles(dt);
      ctx.restore();
    }

    function render() {
      if (parked) { draw(idleFrame, true); return; }
      draw(Math.round(pos));
    }

    function resize() {
      size();
      current = -1;
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
    }

    // Bucle: con scroll activo, el objetivo sigue al progreso y `pos` se le
    // acerca con inercia (nunca salta). En reposo el frame queda congelado
    // en el último mostrado y se anima solo con luces y partículas, así que
    // al reanudar el scroll la animación continúa desde ahí, sin reiniciarse.
    function tick(now) {
      var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      var scrolling = now - lastScroll < 250;

      if (scrolling || !idle) {
        if (parked) { particles.length = 0; }
        parked = false;
        target = progress() * (total - 1);
        pos = idle ? pos + (target - pos) * (1 - Math.exp(-dt * 8)) : target;
        draw(Math.round(pos));
      } else {
        if (!parked) {
          idleFrame = Math.round(pos);
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

  // Luces y colores por defecto para el modo fondo: una cálida (dorada, a
  // tono con la marca) y una fría (azulada, como un motor), con sus
  // partículas. Las posiciones son fracciones del canvas (0..1).
  function defaultIdle() {
    return {
      lights: [
        { x: 0.62, y: 0.47, r: 0.085, period: 2.1, rgb: '255,210,140' },
        { x: 0.78, y: 0.53, r: 0.07, period: 1.7, rgb: '190,225,255' }
      ]
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
