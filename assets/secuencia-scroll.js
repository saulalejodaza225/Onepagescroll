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
 * proporción a lo alto que es (y a un peso); el scroll dentro de una
 * sección solo recorre los frames de esa sección. La velocidad de la
 * secuencia cambia de forma gradual al cruzar de una sección a otra, no de
 * golpe. Sin scroll, el fondo se queda quieto en el frame donde se detuvo
 * (el bucle de animación se apaga solo y se reactiva al hacer scroll).
 *   <canvas data-secuencia-fondo data-frames="..." data-total="157"></canvas>
 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Los frames miden 1280x720: dibujar en un bitmap bastante más grande que
  // ~2 MP solo gasta GPU en cada cuadro sin ganar nada de detalle.
  var MAX_PIXELS = 2.1e6;
  // En celulares y tablets el lienzo se dibuja con menos píxeles: la imagen
  // fuente ya se está ampliando (en vertical solo se ve una franja angosta
  // del frame), así que más resolución no añade detalle, pero sí cuesta
  // relleno de GPU en cada cuadro. El navegador escala el lienzo al
  // tamaño de la pantalla sin que se note.
  var MAX_PIXELS_SMALL = 1.3e6;
  var SMALL_DPR = 1.25;

  function pad(n) {
    return ('000' + n).slice(-3);
  }

  // Tamaño del bitmap del canvas para un área CSS de w x h: respeta el dpr,
  // pero sin pasar de MAX_PIXELS (o de MAX_PIXELS_SMALL en pantallas chicas).
  function bitmapSize(w, h) {
    var small = Math.min(w, h) <= 1100 && Math.max(w, h) <= 1400;
    var k = Math.min(dpr, small ? SMALL_DPR : dpr, Math.sqrt((small ? MAX_PIXELS_SMALL : MAX_PIXELS) / Math.max(1, w * h)));
    k = Math.max(0.5, k);
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }

  // Crea el controlador de un canvas. `progress()` devuelve un valor 0..1.
  // `size()` ajusta el bitmap del canvas y devuelve false si no hizo falta
  // tocarlo (así no se borra ni se redibuja en vano).
  // `smooth` (true en el modo fondo) hace que el frame dibujado siga al del
  // scroll con un resorte, en vez de saltar directo a él.
  // `getPattern()` devuelve la ruta de los frames a usar ahora: en
  // vertical (celulares y tablets) puede ser un set recortado al centro,
  // mucho más liviano de descargar y decodificar; si cambia (al girar el
  // dispositivo) se reinicia la caché de frames.
  // Devuelve { wake }: reactiva el bucle si el progreso cambió sin que
  // hubiera un evento de scroll (p. ej. al cambiar el alto de la página).
  function createPlayer(canvas, getPattern, total, progress, size, smooth) {
    var ctx = canvas.getContext('2d', { alpha: false });
    var pattern = getPattern();
    var frames = new Array(total);
    var decoded = new Uint8Array(total);
    var inflight = 0;         // frames de precarga que todavía se están descargando
    var preloadId = 0;        // invalida una precarga en curso al cambiar de set
    var current = -1;         // frame que de verdad está pintado en el canvas
    var pos = 0;              // posición fraccionaria: lo que se dibuja
    var track = { p: 0, v: 0 }; // resorte que sigue al frame del scroll (posición y velocidad)
    var running = false;      // el bucle de animación solo corre mientras hace falta
    var last = 0;
    var prevPf = null;        // frame que corresponde al scroll, en el cuadro anterior
    var speed = 0;            // velocidad (frames/s) del scroll, suavizada
    var lastPrefetch = -1;

    function frameReady(i) {
      var im = frames[i];
      return !!(im && im.complete && im.naturalWidth);
    }

    function loadFrame(i, low) {
      if (i < 0 || i >= total) return null;
      if (!frames[i]) {
        var img = new Image();
        img.decoding = 'async';
        if (low && 'fetchPriority' in img) img.fetchPriority = 'low';
        if (low) {
          inflight++;
          img.__pre = true;
        }
        // Si el frame llega después de que el scroll ya pidió dibujarlo, se dibuja al cargar.
        img.onload = img.onerror = function (ev) {
          if (img.__pre) {
            img.__pre = false;
            inflight = Math.max(0, inflight - 1);
          }
          if (ev && ev.type === 'load') render();
        };
        img.src = pattern.replace('%03d', pad(i + 1));
        frames[i] = img;
      }
      return frames[i];
    }

    // El frame cargado más cercano a `index` (o -1 si no hay ninguno cerca).
    function nearestReady(index) {
      for (var d = 1; d <= 24; d++) {
        if (frameReady(index - d)) return index - d;
        if (frameReady(index + d)) return index + d;
      }
      return -1;
    }

    // Cubre el canvas manteniendo proporción (equivale a object-fit: cover).
    // Si el frame pedido todavía no cargó, muestra el cargado más cercano en
    // vez de quedarse con uno lejano: la animación nunca se congela.
    function draw(index, force) {
      if (index < 0) return;
      var use = index;
      var img = loadFrame(index);
      if (!frameReady(index)) {
        use = nearestReady(index);
        if (use < 0) return;
        img = frames[use];
      }
      if (use === current && !force) return;
      current = use;
      var cw = canvas.width;
      var ch = canvas.height;
      var scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      var w = img.naturalWidth * scale;
      var h = img.naturalHeight * scale;
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
    }

    function render() {
      draw(Math.round(pos));
    }

    function resize() {
      var next = getPattern();
      var switched = next !== pattern;
      if (switched) {
        pattern = next;
        frames = new Array(total);
        decoded = new Uint8Array(total);
        inflight = 0;
        lastPrefetch = -1;
        startPreload();
      }
      if (size() === false && !switched) return;
      current = -1;
      render();
    }

    // Pide por adelantado los frames que se van a dibujar en los próximos
    // cuadros, en la dirección del movimiento. Con scroll rápido cada cuadro
    // salta varios frames, así que se piden los que de verdad tocarán (a
    // `step` de distancia), no todos los intermedios. Solo con movimiento
    // lento (un frame por cuadro o menos) se decodifican también por
    // adelantado: decodificar todo lo que se cruza en un scroll rápido
    // saturaría el procesador (y la batería en celulares) sin ganar nada.
    function prefetch(idx, dir) {
      if (idx === lastPrefetch) return;
      lastPrefetch = idx;
      var ahead = dir >= 0 ? 1 : -1;
      var step = Math.max(1, Math.round(speed / 60));
      var k, i, im;
      for (k = 1; k <= 4; k++) {
        i = idx + ahead * step * k;
        im = loadFrame(i);
        if (step <= 2 && k <= 2 && im && im.decode && i >= 0 && i < total && !decoded[i]) {
          decoded[i] = 1;
          im.decode().catch(function () {});
        }
      }
      for (k = 1; k <= 2; k++) loadFrame(idx - ahead * step * k);
    }

    // Precarga el resto de frames en tiempo ocioso. En celulares o conexiones
    // lentas/con ahorro de datos no se baja la secuencia completa (953
    // imágenes pueden ser varias decenas de MB): se precarga solo 1 de cada
    // `step` frames, de forma pareja a lo largo de toda la secuencia. Los
    // frames que de verdad se muestran siempre se piden al vuelo, y mientras
    // llegan se muestra el cargado más cercano.
    function preloadStep() {
      var touch = window.matchMedia && window.matchMedia('(pointer: coarse), (max-width: 640px)').matches;
      var conn = navigator.connection || navigator.webkitConnection || navigator.mozConnection;
      var slow = !!(conn && (conn.saveData || /^(slow-2g|2g|3g)$/.test(conn.effectiveType || '')));
      if (slow) return 8;
      if (touch) return 2;
      return 1;
    }

    // Orden de precarga "de grueso a fino": primero 1 de cada 16 frames, luego
    // los de en medio (1 de cada 8, 4, 2 y 1). Así, apenas empieza la
    // descarga ya hay un frame cargado cerca de CUALQUIER punto de la
    // secuencia (y el "frame cargado más cercano" siempre está a pocos
    // pasos), en vez de tener los primeros cargados y el resto vacío hasta
    // el final. Respeta `step` (celulares / conexión lenta).
    function preloadOrder(step) {
      var seen = new Uint8Array(total);
      var order = [];
      var strides = [16, 8, 4, 2, 1];
      for (var s = 0; s < strides.length; s++) {
        if (strides[s] < step) continue;
        for (var i = 0; i < total; i += strides[s]) {
          if (!seen[i]) { seen[i] = 1; order.push(i); }
        }
      }
      if (!seen[total - 1]) order.push(total - 1);
      return order;
    }

    // Precarga en tiempo ocioso, de a pocos frames a la vez (como mucho 6
    // descargas simultáneas de precarga) para no competir con los frames que
    // el scroll pide al momento. Los frames que de verdad se muestran
    // siempre se piden al vuelo; mientras llegan se muestra el cargado más
    // cercano.
    function startPreload() {
      var id = ++preloadId;
      var order = preloadOrder(preloadStep());
      var n = 0;
      var idle = window.requestIdleCallback || function (cb) { setTimeout(function () { cb(null); }, 40); };
      // Primero lo que se ve al abrir la página: el arranque de la secuencia.
      for (var a = 0; a <= 8; a++) loadFrame(a);
      function next(deadline) {
        if (id !== preloadId || n >= order.length) return;
        var batch = 0;
        while (n < order.length && inflight < 6 && batch < 4 &&
               (batch === 0 || !deadline || deadline.timeRemaining() > 6)) {
          loadFrame(order[n++], true);
          batch++;
        }
        if (inflight >= 6) setTimeout(function () { next(null); }, 80);
        else idle(next);
      }
      idle(next);
    }

    // Resorte críticamente amortiguado (solución exacta: estable con
    // cualquier dt). A diferencia de un suavizado exponencial, conserva la
    // velocidad: si el objetivo cambia de golpe, el movimiento acelera de
    // forma gradual en vez de arrancar con un tirón.
    function spring(s, to, omega, dt) {
      var x = s.p - to;
      var e = Math.exp(-omega * dt);
      var t = (s.v + omega * x) * dt;
      s.v = (s.v - omega * t) * e;
      s.p = to + (x + t) * e;
    }

    // Bucle. Cada cuadro el frame dibujado sigue al que corresponde al
    // scroll: con un resorte cuya rigidez crece con la velocidad del scroll
    // (suave si es lento, ajustado si es rápido, para no quedar rezagado), o
    // directo si el modo no es `smooth`. Cuando ya llegó y no hay movimiento,
    // el bucle se apaga solo (la imagen queda quieta y no se gasta batería)
    // y se vuelve a encender con el siguiente scroll.
    function tick(now) {
      var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;

      // Frame que corresponde al scroll, y qué tan rápido se mueve (sube
      // rápido con el scroll y baja despacio al frenar).
      var pf = progress() * (total - 1);
      var moved = prevPf === null || Math.abs(pf - prevPf) > 1e-6;
      if (prevPf !== null && dt > 0) {
        var inst = Math.abs(pf - prevPf) / dt;
        speed += (inst - speed) * Math.min(1, dt * (inst > speed ? 30 : 5));
      }
      prevPf = pf;

      if (smooth) {
        spring(track, pf, 16 + Math.min(44, speed * 0.09), dt);
      } else {
        track.p = pf;
        track.v = 0;
      }
      pos = Math.min(total - 1, Math.max(0, track.p));

      var idx = Math.round(pos);
      draw(idx);
      prefetch(idx, track.v);

      if (!moved && Math.abs(pf - track.p) < 0.02 && Math.abs(track.v) < 0.05) {
        // Quieto: se dibuja el frame exacto del scroll y se apaga el bucle.
        track.p = pf;
        track.v = 0;
        draw(Math.round(Math.min(total - 1, Math.max(0, pf))));
        running = false;
        last = 0;
        prevPf = null;
        speed = 0;
        return;
      }
      requestAnimationFrame(tick);
    }

    // Enciende el bucle si estaba apagado.
    function wake() {
      if (running || reduceMotion) return;
      running = true;
      last = 0;
      requestAnimationFrame(tick);
    }

    pos = track.p = progress() * (total - 1);
    loadFrame(0);
    resize();

    if (reduceMotion) {
      draw(Math.round(pos), true);
      return { wake: function () {} };
    }

    window.addEventListener('scroll', wake, { passive: true });
    window.addEventListener('resize', function () { resize(); wake(); });
    startPreload();
    wake();
    return { wake: wake };
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
      var b = bitmapSize(rect.width, rect.height);
      canvas.width = b.w;
      canvas.height = b.h;
    }

    var fixedPattern = section.getAttribute('data-frames');
    createPlayer(canvas, function () { return fixedPattern; }, total, progress, size, false);
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

  // Tabla scroll -> frame (un valor por pixel de scroll). Cada zona avanza a
  // su propia velocidad (frames por pixel), pero en vez de cambiar de golpe
  // al cruzar una frontera, la velocidad se mezcla con la de la zona vecina
  // a lo largo de una franja alrededor de la frontera (suavizada con
  // smoothstep, así el cambio de velocidad no se nota como un tirón). La
  // mezcla es simétrica, así que cada frontera cae en el mismo frame que
  // tendría con el cambio brusco, y la tabla se normaliza para que el
  // inicio de la página sea el frame 0 y el final el último.
  function makeLut(zones, total) {
    var n = zones.length;
    var max = Math.max(1, Math.round(zones[n - 1].end));
    var speeds = zones.map(function (z) {
      return z.frameCount / Math.max(1, z.end - z.start);
    });
    var bands = [];
    for (var k = 0; k < n - 1; k++) {
      var hA = Math.max(1, zones[k].end - zones[k].start);
      var hB = Math.max(1, zones[k + 1].end - zones[k + 1].start);
      bands.push({ at: zones[k].end, w: Math.max(1, Math.min(140, 0.25 * Math.min(hA, hB))) });
    }

    function speedAt(y) {
      var i = 0;
      while (i < n - 1 && y >= zones[i].end) i++;
      var s = speeds[i];
      for (var j = 0; j < bands.length; j++) {
        var d = y - bands[j].at;
        if (Math.abs(d) < bands[j].w) {
          var t = (d + bands[j].w) / (2 * bands[j].w);
          s = speeds[j] + (speeds[j + 1] - speeds[j]) * (t * t * (3 - 2 * t));
        }
      }
      return s;
    }

    var lut = new Float32Array(max + 2);
    var acc = 0;
    var y;
    for (y = 0; y <= max; y++) {
      lut[y] = acc;
      acc += speedAt(y + 0.5);
    }
    lut[max + 1] = acc;
    var norm = Math.max(1, total - 1) / Math.max(1e-6, acc);
    for (y = 0; y <= max + 1; y++) lut[y] *= norm;
    return lut;
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
    var zones = null;
    var lut = null;

    // Recalcula dónde cae cada sección. Se llama al cambiar el tamaño de la
    // ventana y también cuando el contenido cambia de alto solo (cargan las
    // fuentes, aparece una imagen...), si no las zonas quedarían desfasadas
    // de las secciones reales y el fondo no iría sincronizado con el texto.
    function refreshZones() {
      if (!computeZones) return;
      zones = computeZones();
      lut = makeLut(zones, total);
    }
    refreshZones();

    // Frame (0..total-1, fraccionario) que corresponde a una posición de
    // scroll `y` (si no hay 4 secciones detectadas, recorre toda la
    // secuencia con el scroll de la página, como antes).
    function frameAtY(y) {
      if (!lut) {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        return (max > 0 ? Math.min(1, Math.max(0, y / max)) : 0) * (total - 1);
      }
      var top = lut.length - 2;
      y = y < 0 ? 0 : (y > top ? top : y);
      var i = y | 0;
      var f = y - i;
      return lut[i] + (lut[i + 1] - lut[i]) * f;
    }

    // Lo inverso: la posición de scroll `y` en la que se ve el frame `f`
    // (búsqueda binaria en la tabla, que siempre crece). Sirve para recorrer
    // la secuencia a ritmo parejo de frames, sin importar cuánto texto o
    // cuántos pixeles ocupe cada sección.
    function yAtFrame(f) {
      if (!lut) {
        var max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        return Math.min(1, Math.max(0, f / Math.max(1, total - 1))) * max;
      }
      var lo = 0;
      var hi = lut.length - 2;
      if (f <= lut[0]) return 0;
      if (f >= lut[hi]) return hi;
      while (hi - lo > 1) {
        var mid = (lo + hi) >> 1;
        if (lut[mid] <= f) lo = mid; else hi = mid;
      }
      var span = lut[hi] - lut[lo];
      return lo + (span > 0 ? (f - lut[lo]) / span : 0);
    }

    // Frame que corresponde al scroll actual, como fracción 0..1 de la
    // secuencia.
    function progress() {
      return frameAtY(window.scrollY) / Math.max(1, total - 1);
    }

    // API para otros scripts de la página (el scroll controlado del logo).
    window.nocturneSeq = { frameAtY: frameAtY, yAtFrame: yAtFrame, total: total };

    // Ajusta el bitmap del canvas. En celulares la barra de direcciones
    // aparece y desaparece al hacer scroll y cambia el alto de la ventana
    // unos 50-110px; recrear el bitmap en cada cambio (borra el canvas y es
    // caro) provocaría parpadeos, así que los cambios chicos de alto se
    // ignoran: el canvas usa object-fit: cover y solo recorta un poco.
    var lastW = 0;
    var lastH = 0;
    function size() {
      var w = window.innerWidth;
      var h = window.innerHeight;
      if (canvas.width && w === lastW && Math.abs(h - lastH) < 160) {
        // Solo cambió el alto un poco (barra de direcciones del celular): el
        // bitmap se queda igual y las zonas se recalculan sin prisa (un solo
        // recálculo cada ~120 ms, aunque lleguen decenas de eventos).
        scheduleRefresh();
        return false;
      }
      refreshZones();
      lastW = w;
      lastH = h;
      var b = bitmapSize(w, h);
      canvas.width = b.w;
      canvas.height = b.h;
      return true;
    }

    // Si el contenido cambia de alto sin que cambie la ventana, también hay
    // que recalcular (y reactivar el bucle, que puede estar apagado porque
    // no hay scroll).
    var player = null;
    var refreshTimer = 0;
    function scheduleRefresh() {
      if (refreshTimer) return;
      refreshTimer = setTimeout(function () {
        refreshTimer = 0;
        refreshZones();
        if (player) player.wake();
      }, 120);
    }
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(scheduleRefresh).observe(document.body);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleRefresh);
    window.addEventListener('load', scheduleRefresh);

    // Set de frames: en vertical (celulares y tablets en retrato) se usa el
    // recortado al centro (data-frames-portrait), idéntico en encuadre a lo
    // que se vería del completo pero con ~2.2x menos píxeles que decodificar
    // y la mitad de bytes. Con histéresis, para que el pequeño cambio de
    // alto de la barra del navegador no lo haga saltar de uno a otro.
    var fullPattern = canvas.getAttribute('data-frames');
    var portraitPattern = canvas.getAttribute('data-frames-portrait');
    var usePortrait = false;
    function getPattern() {
      if (!portraitPattern) return fullPattern;
      var ar = window.innerWidth / Math.max(1, window.innerHeight);
      usePortrait = usePortrait ? ar <= 0.82 : ar <= 0.78;
      return usePortrait ? portraitPattern : fullPattern;
    }

    player = createPlayer(canvas, getPattern, total, progress, size, true);
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
