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
 * en el último que se mostró; se recorta en una cuadrícula y cada fragmento
 * flota por su cuenta (antigravedad), con luces pulsantes encima.
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
  // `idle` (o null) describe las luces y la cuadrícula de piezas flotantes
  // que decoran el frame congelado cuando no hay scroll. Ver `defaultIdle()`.
  function createPlayer(canvas, pattern, total, progress, size, idle) {
    var ctx = canvas.getContext('2d');
    var frames = new Array(total);
    var current = -1;
    var pos = 0;              // posición fraccionaria, lo que se dibuja (con inercia)
    var target = 0;           // posición hacia la que `pos` se acerca cada frame
    var lastScroll = -Infinity;
    var parked = false;       // true mientras el frame está congelado (reposo)
    var idleFrame = 0;        // frame en el que quedó congelada la secuencia
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

    // Recorta el frame congelado en una cuadrícula y dibuja cada fragmento con
    // su propio vaivén (fase y amplitud distintas), como si las piezas de la
    // nave flotaran sueltas en gravedad cero. No hay piezas reales recortadas
    // de la nave (los frames son imágenes planas), así que esto es una
    // cuadrícula pareja sobre toda la imagen, no un recorte de cada pieza.
    function drawFloatingPieces(img, now) {
      var cw = canvas.width;
      var ch = canvas.height;
      var scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      var dw = img.naturalWidth * scale;
      var dh = img.naturalHeight * scale;
      var ox = (cw - dw) / 2;
      var oy = (ch - dh) / 2;

      var cols = idle.grid.cols;
      var rows = idle.grid.rows;
      var sw = img.naturalWidth / cols;
      var sh = img.naturalHeight / rows;
      var dTileW = dw / cols;
      var dTileH = dh / rows;
      var amp = idle.grid.amplitude * Math.min(cw, ch);
      var t = now / 1000;

      ctx.clearRect(0, 0, cw, ch);
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          // Fase y velocidad propias de cada pieza, fijas pero distintas entre sí.
          var seed = (r * cols + c) * 12.9898;
          var phase = ((Math.sin(seed) * 43758.5453) % 1) * Math.PI * 2;
          var speed = 0.35 + (Math.abs(Math.sin(seed * 1.7)) * 0.5);
          var offX = Math.sin(t * speed + phase) * amp * (0.5 + Math.abs(Math.sin(seed * 2.3)));
          var offY = Math.cos(t * speed * 0.8 + phase * 1.3) * amp * (0.6 + Math.abs(Math.cos(seed * 1.3)));

          var dx = ox + c * dTileW + offX;
          var dy = oy + r * dTileH + offY;
          ctx.drawImage(img, c * sw, r * sh, sw, sh, dx, dy, dTileW + 1, dTileH + 1);
        }
      }
    }

    // Dibuja el frame congelado, recortado en piezas que flotan por su cuenta,
    // y encima las luces pulsantes.
    function drawIdle(now) {
      var img = loadFrame(idleFrame);
      if (!img || !img.complete || !img.naturalWidth) return;
      drawFloatingPieces(img, now);

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
        // Al salir del reposo, fuerza un redibujado limpio: el frame congelado
        // pudo quedar pintado en piezas sueltas y con las luces encima.
        if (parked) { current = -1; }
        parked = false;
        target = progress() * (total - 1);
        pos = idle ? pos + (target - pos) * (1 - Math.exp(-dt * 8)) : target;
        draw(Math.round(pos));
      } else {
        if (!parked) {
          idleFrame = Math.round(pos);
          parked = true;
        }
        drawIdle(now);
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

  // Configuración por defecto del modo fondo en reposo: luces pulsantes
  // (una cálida, a tono con la marca, y una fría, como un motor; posiciones
  // en fracciones del canvas) y la cuadrícula con la que se recorta el frame
  // para el efecto de piezas flotando en antigravedad.
  function defaultIdle() {
    return {
      lights: [
        { x: 0.62, y: 0.47, r: 0.085, period: 2.1, rgb: '255,210,140' },
        { x: 0.78, y: 0.53, r: 0.07, period: 1.7, rgb: '190,225,255' }
      ],
      grid: { cols: 10, rows: 6, amplitude: 0.006 }
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
