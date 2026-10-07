/*
 * Secuencia de imágenes vinculada al scroll, dibujada en un canvas.
 *
 * Modo sección (data-secuencia): el frame depende del avance de una sección.
 *   <section data-secuencia data-frames="assets/secuencia/frame-%03d.webp" data-total="157">
 *     <div class="sticky top-0 h-screen"><canvas></canvas></div>
 *   </section>
 *
 * Modo fondo (data-secuencia-fondo): un canvas fijo que cubre el viewport y
 * avanza con el scroll de toda la página, dividida en 4 zonas (una por
 * sección: #inicio, la guía "¿Cuál es tu página?", la matriz comparativa y
 * #contacto). Cada zona tiene asignado un tramo de frames propio, en
 * proporción a lo alto que es; el scroll dentro de una sección solo
 * recorre los frames de esa sección. Sin scroll, la nave queda
 * "estacionada": oscila con inercia entre unos pocos frames cercanos al
 * punto donde se detuvo (sin salir del tramo de esa sección), o, antes del
 * primer scroll, cercanos a un frame elegido a mano por impacto visual.
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
    var hasScrolled = false;  // false hasta el primer scroll real del usuario
    var parked = false;       // true mientras dura el reposo (vaivén en bucle)
    var idleAnchor = 0;       // frame alrededor del cual oscila el reposo
    var idleStart = 0;
    var idleTimer = null;     // dispara el inicio del reposo una sola vez por parada
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

    // Precarga el resto de frames en tiempo ocioso. En celulares o conexiones
    // lentas/con ahorro de datos no se baja la secuencia completa (953
    // imágenes pueden ser varias decenas de MB): se precarga solo 1 de cada
    // `step` frames, de forma pareja a lo largo de toda la secuencia. Los
    // frames que de verdad se muestran siempre se piden al vuelo desde
    // `draw()`, así que el scroll sigue funcionando bien, solo que una
    // imagen no precargada puede tardar un instante en aparecer.
    function preloadStep() {
      var narrow = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
      var conn = navigator.connection || navigator.webkitConnection || navigator.mozConnection;
      var slow = !!(conn && (conn.saveData || /^(slow-2g|2g|3g)$/.test(conn.effectiveType || '')));
      if (slow) return 8;
      if (narrow) return 4;
      return 1;
    }

    function preload() {
      var step = preloadStep();
      var i = 0;
      function next() {
        if (i >= total) return;
        loadFrame(i);
        i += step;
        (window.requestIdleCallback || function (cb) { setTimeout(cb, 40); })(next);
      }
      next();
    }

    // Entra en reposo una sola vez por parada: lo dispara el temporizador de
    // onScroll, nunca el propio bucle, así que el ancla y la fase del vaivén
    // no se reinician mientras el reposo sigue en curso.
    function enterIdle() {
      idleTimer = null;
      if (parked || !idle) return;
      idleAnchor = (!hasScrolled && idle.initialFrame != null)
        ? Math.max(0, Math.min(total - 1, idle.initialFrame))
        : pos;
      idleStart = performance.now();
      parked = true;
    }

    function onScroll() {
      hasScrolled = true;
      parked = false;
      if (idleTimer) clearTimeout(idleTimer);
      if (idle) idleTimer = setTimeout(enterIdle, 300);
    }

    // Bucle: con scroll activo, el objetivo sigue al progreso y `pos` se le
    // acerca con inercia (nunca salta). 0.3s después de que el scroll se
    // detiene (una sola vez, vía el temporizador de onScroll), el objetivo
    // empieza a oscilar entre unos pocos frames alrededor del punto donde se
    // detuvo (o, la primera vez, alrededor de un frame elegido a mano),
    // simulando una nave "estacionada"; esa oscilación sigue como un bucle
    // continuo mientras dure el reposo, sin reiniciarse. Al reanudar el
    // scroll, la posición sigue acercándose con la misma inercia desde el
    // frame donde quedó el reposo, sin reiniciarse de golpe.
    function tick(now) {
      var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;

      if (!parked || !idle) {
        target = progress() * (total - 1);
      } else {
        // El vaivén no sale del rango de frames de la sección donde quedó
        // el ancla, para no mezclar imágenes de secciones distintas.
        var bounds = idle.zoneBounds ? idle.zoneBounds(idleAnchor) : [0, total - 1];
        var wave = Math.sin((now - idleStart) / 1000 * (2 * Math.PI / idle.period));
        target = Math.min(bounds[1], Math.max(bounds[0], idleAnchor + wave * idle.amplitude));
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
    // Mismo retraso de 0.3s antes del primer reposo, aunque el usuario
    // todavía no haya hecho scroll ninguna vez.
    if (idle) idleTimer = setTimeout(enterIdle, 300);
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

  // Divide la página en zonas (una por sección) y reparte los frames entre
  // ellas, en proporción a lo alto que es cada una. Dentro de cada zona, el
  // scroll recorre solo los frames que le tocaron: el inicio nunca muestra
  // frames pensados para la matriz comparativa, por ejemplo. `els` es la
  // lista de elementos que marcan dónde empieza cada zona (la última va
  // hasta el final del scroll de la página).
  // `weights` (opcional, uno por zona) multiplica lo que le toca a cada una
  // más allá de su alto: una zona con peso 2 recorre el doble de frames que
  // le tocarían solo por altura, así que el mismo scroll se siente más
  // movido (más cambios de frame por píxel) en esa sección.
  function makeZones(els, total, weights) {
    function docTop(el) {
      var r = el.getBoundingClientRect();
      return r.top + window.scrollY;
    }

    return function compute() {
      var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      var starts = els.map(docTop).concat([max]);
      var zones = [];
      var heights = [];
      for (var i = 0; i < els.length; i++) {
        heights.push(Math.max(1, starts[i + 1] - starts[i]));
      }
      var w = weights || els.map(function () { return 1; });
      var weighted = heights.map(function (h, i) { return h * w[i]; });
      var totalW = weighted.reduce(function (a, b) { return a + b; }, 0);
      var frameCounts = weighted.map(function (wh) {
        return Math.max(1, Math.round((wh / totalW) * total));
      });
      // El redondeo puede dejar la suma unos frames por encima o por debajo
      // de `total`. El ajuste va a la zona con más peso (la que menos se
      // nota), nunca a la última al azar: una zona de scroll corta (p. ej.
      // el cierre) seguiría recorriendo solo los frames que le tocan.
      var sum = frameCounts.reduce(function (a, b) { return a + b; }, 0);
      var biggest = weighted.indexOf(Math.max.apply(null, weighted));
      frameCounts[biggest] = Math.max(1, frameCounts[biggest] + (total - sum));
      var frameStart = 0;
      for (i = 0; i < els.length; i++) {
        zones.push({
          start: starts[i],
          end: starts[i + 1],
          frameStart: frameStart,
          frameCount: frameCounts[i]
        });
        frameStart += frameCounts[i];
      }
      return zones;
    };
  }

  function initFondo(canvas) {
    var total = parseInt(canvas.getAttribute('data-total'), 10) || 1;

    var zoneEls = ['#inicio', '#guia .guia-head', '#guia .matrix', '#contacto']
      .map(function (sel) { return document.querySelector(sel); })
      .filter(Boolean);
    // El inicio recorre varias veces los frames que le tocarían solo por
    // alto: el mismo scroll se siente mucho más movido y dinámico ahí, y
    // llega bastante más lejos en la secuencia (bien pasado el anillo de
    // energía, hacia la zona de mayor transformación de la nave).
    var zoneWeights = [3.2, 1, 0.75, 0.6];
    var computeZones = zoneEls.length === 4 ? makeZones(zoneEls, total, zoneWeights) : null;
    var zones = computeZones ? computeZones() : null;

    function zoneAt(y) {
      for (var i = 0; i < zones.length; i++) {
        if (y < zones[i].end || i === zones.length - 1) return zones[i];
      }
      return zones[zones.length - 1];
    }

    function zoneForFrame(frame) {
      for (var i = 0; i < zones.length; i++) {
        var last = zones[i].frameStart + zones[i].frameCount - 1;
        if (frame <= last || i === zones.length - 1) return zones[i];
      }
      return zones[zones.length - 1];
    }

    // Avance dentro de la sección actual, mapeado a los frames que le
    // tocaron a esa sección (si no hay 4 secciones detectadas, recorre toda
    // la secuencia con el scroll de la página, como antes).
    function progress() {
      if (!zones) {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      }
      var z = zoneAt(window.scrollY);
      var span = Math.max(1, z.end - z.start);
      var local = Math.min(1, Math.max(0, (window.scrollY - z.start) / span));
      var frame = z.frameStart + local * (z.frameCount - 1);
      return frame / (total - 1);
    }

    function size() {
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      if (computeZones) zones = computeZones();
    }

    var idle = canvas.getAttribute('data-idle') === 'off' ? null : defaultIdle();
    if (idle && zones) {
      idle.zoneBounds = function (frame) {
        var z = zoneForFrame(Math.round(frame));
        return [z.frameStart, z.frameStart + z.frameCount - 1];
      };
    }

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
