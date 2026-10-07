/*
 * Secuencia de imágenes vinculada al scroll, dibujada en un canvas.
 *
 * Modo sección (data-secuencia): el frame depende del avance de una sección.
 *   <section data-secuencia data-frames="assets/secuencia/frame-%03d.webp" data-total="157">
 *     <div class="sticky top-0 h-screen"><canvas></canvas></div>
 *   </section>
 *
 * Modo fondo (data-secuencia-fondo): un canvas fijo que cubre el viewport y
 * avanza con el scroll de toda la página. Sin scroll, la nave queda
 * "estacionada": oscila con inercia entre unos pocos frames cercanos al
 * punto donde se detuvo el scroll (o, antes del primer scroll, cercanos a
 * un frame elegido a mano por impacto visual), como un vaivén suave.
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
  // `idle` ({amplitude, period, initialFrame} o null) activa el vaivén de
  // "estacionamiento" cuando no hay scroll. Ver `defaultIdle()`.
  function createPlayer(canvas, pattern, total, progress, size, idle) {
    var ctx = canvas.getContext('2d');
    var frames = new Array(total);
    var current = -1;
    var pos = 0;              // posición fraccionaria, lo que se dibuja (con inercia)
    var target = 0;           // posición hacia la que `pos` se acerca cada frame
    var lastScroll = -Infinity;
    var hasScrolled = false;  // false hasta el primer scroll real del usuario
    var parked = false;       // true mientras no hay scroll (reposo)
    var idleAnchor = 0;       // frame alrededor del cual oscila el reposo
    var idleStart = 0;
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

    function render() {
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
      hasScrolled = true;
    }

    // Bucle: con scroll activo, el objetivo sigue al progreso y `pos` se le
    // acerca con inercia (nunca salta). En reposo, el objetivo oscila entre
    // unos pocos frames alrededor del punto donde se detuvo el scroll (o, la
    // primera vez, alrededor de un frame elegido a mano), simulando una nave
    // "estacionada" con un leve vaivén. Al reanudar el scroll, la posición
    // sigue acercándose con la misma inercia, sin reiniciarse de golpe.
    function tick(now) {
      var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      var scrolling = now - lastScroll < 250;

      if (scrolling || !idle) {
        parked = false;
        target = progress() * (total - 1);
      } else {
        if (!parked) {
          idleAnchor = (!hasScrolled && idle.initialFrame != null)
            ? Math.max(0, Math.min(total - 1, idle.initialFrame))
            : pos;
          idleStart = now;
          parked = true;
        }
        var wave = Math.sin((now - idleStart) / 1000 * (2 * Math.PI / idle.period));
        target = Math.min(total - 1, Math.max(0, idleAnchor + wave * idle.amplitude));
      }

      pos = idle ? pos + (target - pos) * (1 - Math.exp(-dt * 8)) : target;
      draw(Math.round(pos));
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

  // Configuración por defecto del modo fondo en reposo: amplitud (en
  // frames) y periodo (en segundos) del vaivén, y el frame alrededor del
  // cual oscila antes del primer scroll (índice 0-based; 116 = frame_117,
  // la nave con el anillo de energía encendido). Con los 953 frames
  // interpolados (4x los 240 originales), estos valores siguen
  // correspondiendo al mismo rango de movimiento y tiempo real de antes.
  function defaultIdle() {
    return { amplitude: 72, period: 14, initialFrame: 116 };
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
