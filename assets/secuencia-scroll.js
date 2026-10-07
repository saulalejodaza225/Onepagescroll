/*
 * Secuencia de imágenes vinculada al scroll, dibujada en un canvas.
 *
 * Modo sección (data-secuencia): el frame depende del avance de una sección.
 *   <section data-secuencia data-frames="assets/secuencia/frame-%03d.webp" data-total="157">
 *     <div class="sticky top-0 h-screen"><canvas></canvas></div>
 *   </section>
 *
 * Modo fondo (data-secuencia-fondo): un canvas fijo que cubre el viewport y
 * avanza con el scroll de toda la página.
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
  // `idle` ({amplitude, period}) hace que, sin scroll, la secuencia quede "parqueada"
  // en el frame donde se detuvo y oscile unos pocos frames alrededor (0 = desactivado).
  function createPlayer(canvas, pattern, total, progress, size, idle) {
    var ctx = canvas.getContext('2d');
    var frames = new Array(total);
    var lastDrawn = -1;       // última posición (redondeada a 0.01) ya pintada
    var pos = 0;              // posición fraccionaria dentro de la secuencia
    var lastScroll = -Infinity;
    var wasScrolling = true;  // fuerza fijar el ancla la primera vez que entra en reposo
    var idleAnchor = 0;       // frame donde quedó "parqueada" la nave
    var idleStart = 0;

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

    // Dibuja una imagen cubriendo el canvas (equivale a object-fit: cover).
    function drawImageCover(img, alpha) {
      var cw = canvas.width;
      var ch = canvas.height;
      var scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      var w = img.naturalWidth * scale;
      var h = img.naturalHeight * scale;
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
      ctx.globalAlpha = 1;
    }

    // Mezcla el frame inferior y el superior de `p` según su parte fraccionaria,
    // para que el movimiento entre frames se vea continuo y no a saltos.
    function draw(p, force) {
      if (p < 0) return;
      if (Math.abs(p - lastDrawn) < 0.004 && !force) return;
      var i0 = Math.min(total - 1, Math.floor(p));
      var t = p - i0;
      var img0 = loadFrame(i0);
      if (!img0 || !img0.complete || !img0.naturalWidth) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawImageCover(img0, 1);
      if (t > 0.004 && i0 + 1 < total) {
        var img1 = loadFrame(i0 + 1);
        if (img1 && img1.complete && img1.naturalWidth) {
          drawImageCover(img1, t);
        }
      }
      lastDrawn = p;
    }

    function render() {
      draw(pos);
    }

    function resize() {
      size();
      lastDrawn = -1;
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

    // Bucle: con scroll activo, el frame sigue al progreso. En reposo la nave
    // queda "parqueada" en ese frame y solo oscila unos pocos frames alrededor,
    // como un leve balanceo, en vez de recorrer la secuencia completa.
    function tick(now) {
      var scrolling = now - lastScroll < 250;
      if (scrolling || !idle) {
        pos = progress() * (total - 1);
        wasScrolling = true;
      } else {
        if (wasScrolling) {
          idleAnchor = pos;
          idleStart = now;
          wasScrolling = false;
        }
        var wave = Math.sin((now - idleStart) / 1000 * (2 * Math.PI / idle.period));
        pos = Math.min(total - 1, Math.max(0, idleAnchor + wave * idle.amplitude));
      }
      draw(pos);
      requestAnimationFrame(tick);
    }

    pos = progress() * (total - 1);
    loadFrame(0).addEventListener('load', function () { render(); });
    resize();

    if (reduceMotion) {
      draw(pos, true);
      return;
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', resize);
    preload();
    requestAnimationFrame(tick);
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

    createPlayer(canvas, section.getAttribute('data-frames'), total, progress, size, 0);
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

    // Amplitud en frames del balanceo en reposo, y duración de un ciclo completo.
    // Con el crossfade entre frames, una amplitud mayor sigue viéndose como un
    // balanceo suave y fluido, no como un salto.
    var amplitude = parseFloat(canvas.getAttribute('data-idle-amplitude'));
    if (isNaN(amplitude)) amplitude = 18;
    var period = parseFloat(canvas.getAttribute('data-idle-period'));
    if (isNaN(period) || period <= 0) period = 14;
    var idle = amplitude > 0 ? { amplitude: amplitude, period: period } : null;

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
