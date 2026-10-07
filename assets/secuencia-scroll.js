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
  function createPlayer(canvas, pattern, total, progress, size) {
    var ctx = canvas.getContext('2d');
    var frames = new Array(total);
    var current = -1;

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
      draw(Math.round(progress() * (total - 1)));
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

    var pending = false;
    function onScroll() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        render();
      });
    }

    loadFrame(0).addEventListener('load', function () { render(); });
    resize();

    if (reduceMotion) {
      draw(0, true);
      return;
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', resize);
    preload();
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

    createPlayer(canvas, section.getAttribute('data-frames'), total, progress, size);
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

    createPlayer(canvas, canvas.getAttribute('data-frames'), total, progress, size);
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
