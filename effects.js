(function() {
  const wrap = document.getElementById('wrap');
  const canvas = document.getElementById('gl');
  const cursor = document.getElementById('cursor');
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

  if (!gl) {
    wrap.innerHTML = '<p style="color:#fff;padding:2rem">WebGL not available</p>';
    return;
  }

  let W = 1;
  let H = 1;
  let mx = -1;
  let my = -1;
  let smx = 0.5;
  let smy = 0.5;
  let cx = -100;
  let cy = -100;
  let sceneTex = null;
  let fontReady = false;

  // Per-letter Y offsets for scroll animation
  const HEADLINE = 'made different.';
  // Each letter gets a fixed random speed multiplier so they scatter at different rates
  const letterStates = HEADLINE.split('').map(() => ({
    offsetY: 0,
    speed: 0.75 + Math.random() * 0.5
  }));
  let scrollVelocity = 0;
  let lettersAnimating = false;

  // Cached offscreen canvas — reused each frame to avoid GC pressure
  let oc = null;
  let octx = null;

  function buildSceneTexture() {
    if (!oc || oc.width !== W || oc.height !== H) {
      oc = document.createElement('canvas');
      oc.width = W;
      oc.height = H;
      octx = oc.getContext('2d');
    }
    const c = octx;

    c.fillStyle = '#080806';
    c.fillRect(0, 0, W, H);

    c.fillStyle = 'rgba(255,255,255,0.04)';
    const step = Math.max(22, Math.round(Math.min(W, H) * 0.022));
    for (let x = step * 0.5; x < W; x += step) {
      for (let y = step * 0.5; y < H; y += step) {
        c.beginPath();
        c.arc(x, y, Math.max(0.7, step * 0.035), 0, Math.PI * 2);
        c.fill();
      }
    }

    // Draw headline letter by letter so each can have its own Y offset
    const headlineSize = Math.round(W * 0.0575);
    c.font = `800 ${headlineSize}px 'KollektifCustom','Helvetica Neue',Arial,sans-serif`;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillStyle = '#f0ece4';

    const totalWidth = c.measureText(HEADLINE).width;
    const startX = W * 0.5 - totalWidth / 2;
    const ly = H * 0.36;

    // Use substring measurement for each letter so kerning is accounted for
    for (let i = 0; i < HEADLINE.length; i++) {
      const lx = startX + c.measureText(HEADLINE.slice(0, i)).width;
      const oy = letterStates[i].offsetY;
      c.fillText(HEADLINE[i], lx, ly + oy);
    }

    const subSize = Math.round(W * 0.012);
    c.font = `100 ${subSize}px 'KollektifCustom','Helvetica Neue',Arial,sans-serif`;
    c.textAlign = 'center';
    c.fillStyle = 'rgba(240,236,228,0.32)';
    c.fillText('creative dev studio · vienna', W * 0.5, H * 0.83);

    if (sceneTex) gl.deleteTexture(sceneTex);
    sceneTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, oc);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function resize() {
    const r = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(r.width * dpr));
    H = Math.max(1, Math.round(r.height * dpr));
    canvas.width = W;
    canvas.height = H;
    gl.viewport(0, 0, W, H);
    if (fontReady) {
      buildSceneTexture();
    }
  }

  function setMouseFromEvent(e) {
    const r = wrap.getBoundingClientRect();
    mx = (e.clientX - r.left) / r.width;
    my = (e.clientY - r.top) / r.height;
    cx = e.clientX;
    cy = e.clientY;
    cursor.style.opacity = '1';
  }

  wrap.addEventListener('mousemove', setMouseFromEvent);
  wrap.addEventListener('mouseleave', () => {
    mx = -1;
    cursor.style.opacity = '0';
  });
  wrap.addEventListener('touchstart', e => {
    if (e.touches && e.touches[0]) setMouseFromEvent(e.touches[0]);
  }, { passive: true });

  function updateCursor() {
    if (mx < 0) return;
    cursor.style.transform = `translate3d(${cx - 6}px, ${cy - 6}px, 0)`;
  }

  wrap.addEventListener('touchmove', e => {
    if (e.touches && e.touches[0]) setMouseFromEvent(e.touches[0]);
  }, { passive: true });

  // --- Letter animation ---

  function updateLetterAnimations() {
    scrollVelocity *= 0.88;

    const scrolling = scrollVelocity > 0.5;
    // wrap thresholds in canvas px: letter sits at H*0.36, so offset < -H*0.45 = off top
    const wrapTop    = -H * 0.45;
    const wrapBottom =  H * 0.65;

    let anyActive = scrolling;
    letterStates.forEach(state => {
      if (scrolling) {
        state.offsetY -= scrollVelocity * state.speed * 0.5;
        if (state.offsetY < wrapTop) state.offsetY = wrapBottom;
        anyActive = true;
      } else if (Math.abs(state.offsetY) > 0.5) {
        // Spring back to rest
        state.offsetY *= 0.92;
        anyActive = true;
      } else {
        state.offsetY = 0;
      }
    });

    lettersAnimating = anyActive;
  }

  wrap.addEventListener('wheel', e => {
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 40;
    if (e.deltaMode === 2) delta *= 800;
    if (delta > 0) scrollVelocity = Math.min(scrollVelocity + delta, 800);
  }, { passive: true });

  let lastTouchY = 0;
  wrap.addEventListener('touchstart', e => {
    if (e.touches[0]) lastTouchY = e.touches[0].clientY;
  }, { passive: true });
  wrap.addEventListener('touchmove', e => {
    if (e.touches[0]) {
      const dy = lastTouchY - e.touches[0].clientY;
      if (dy > 0) scrollVelocity = Math.min(scrollVelocity + dy * 2, 800);
      lastTouchY = e.touches[0].clientY;
    }
  }, { passive: true });

  // --- WebGL setup ---

  const vert = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = a_pos * 0.5 + 0.5;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  const frag = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_scene;
    uniform vec2 u_mouse;
    uniform float u_radius;
    uniform float u_strength;
    uniform float u_blur;
    uniform float u_time;
    uniform float u_aspect;
    uniform vec2 u_px;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }

    vec2 poissonDisk[12];
    void initPoisson() {
      poissonDisk[0]  = vec2(-0.326, -0.406);
      poissonDisk[1]  = vec2(-0.840, -0.074);
      poissonDisk[2]  = vec2(-0.696,  0.457);
      poissonDisk[3]  = vec2(-0.203,  0.621);
      poissonDisk[4]  = vec2( 0.962, -0.195);
      poissonDisk[5]  = vec2( 0.473, -0.480);
      poissonDisk[6]  = vec2( 0.519,  0.767);
      poissonDisk[7]  = vec2( 0.185, -0.893);
      poissonDisk[8]  = vec2( 0.507,  0.064);
      poissonDisk[9]  = vec2( 0.896,  0.412);
      poissonDisk[10] = vec2(-0.322, -0.933);
      poissonDisk[11] = vec2(-0.792, -0.598);
    }

    void main() {
      initPoisson();

      vec2 uv = v_uv;
      vec2 mouseUV = vec2(u_mouse.x, 1.0 - u_mouse.y);
      vec2 asp = vec2(u_aspect, 1.0);
      vec2 delta = (uv - mouseUV) * asp;
      float dist = length(delta);

      float norm = clamp(dist / u_radius, 0.0, 1.0);
      float strength = pow(1.0 - norm, 2.2);

      vec2 dir = normalize(delta + vec2(0.0001));
      vec2 tang = vec2(-dir.y, dir.x);

      float n1 = noise(uv * 3.5 + u_time * 0.18) * 2.0 - 1.0;
      float n2 = noise(uv * 2.8 + u_time * 0.13 + 5.3) * 2.0 - 1.0;
      vec2 noiseOff = vec2(n1, n2) * 0.003 * strength;
      float tangN = noise(uv * 4.0 + u_time * 0.22 + 2.1) * 2.0 - 1.0;

      float disp = u_strength * strength;
      float blurFalloff = strength * 0.75;
      float blurR = u_blur * blurFalloff;

      vec2 offR = dir * (disp * 1.0) / asp + tang * (tangN * disp * 0.3) / asp + noiseOff;
      vec2 offG = noiseOff * 0.4 + dir * (disp * 0.08) / asp;
      vec2 offB = -dir * (disp * 0.88) / asp - tang * (tangN * disp * 0.25) / asp + noiseOff * 0.9;

      vec2 sampleUV = mouseUV + (uv - mouseUV) * (1.0 - strength * 0.10);
      sampleUV += tang * (tangN * strength * 0.006) / asp + noiseOff * 0.35;

      float angle = u_time * 0.5;
      float ca = cos(angle);
      float sa = sin(angle);

      float r = 0.0;
      float g = 0.0;
      float b = 0.0;
      float wSum = 0.0;

      for (int i = 0; i < 12; i++) {
        vec2 s = poissonDisk[i];
        vec2 sr = vec2(s.x * ca - s.y * sa, s.x * sa + s.y * ca);
        vec2 sOff = sr * blurR * u_px;
        float w = exp(-dot(sr, sr) * 2.5);

        r += texture2D(u_scene, clamp(sampleUV + offR + sOff, 0.001, 0.999)).r * w;
        g += texture2D(u_scene, clamp(sampleUV + offG + sOff * 0.5, 0.001, 0.999)).g * w;
        b += texture2D(u_scene, clamp(sampleUV + offB + sOff, 0.001, 0.999)).b * w;
        wSum += w;
      }

      r /= wSum;
      g /= wSum;
      b /= wSum;

      vec4 base = texture2D(u_scene, sampleUV);
      float blend = smoothstep(0.0, 0.18, strength);
      vec3 aberrated = vec3(r, g, b) * (1.0 - strength * 0.1);
      float grain = hash(uv + fract(u_time * 0.07)) * 0.04 - 0.02;

      vec3 col = mix(base.rgb, aberrated, blend) + grain;
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vert));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uScene    = gl.getUniformLocation(prog, 'u_scene');
  const uMouse    = gl.getUniformLocation(prog, 'u_mouse');
  const uRadius   = gl.getUniformLocation(prog, 'u_radius');
  const uStrength = gl.getUniformLocation(prog, 'u_strength');
  const uBlur     = gl.getUniformLocation(prog, 'u_blur');
  const uTime     = gl.getUniformLocation(prog, 'u_time');
  const uAspect   = gl.getUniformLocation(prog, 'u_aspect');
  const uPx       = gl.getUniformLocation(prog, 'u_px');

  Promise.all([
    document.fonts.load("800 64px KollektifCustom"),
    document.fonts.load("300 24px KollektifCustom"),
    document.fonts.ready
  ]).catch(() => {}).finally(() => {
    fontReady = true;
    resize();
  });

  window.addEventListener('resize', resize);

  const start = performance.now();

  function frame() {
    requestAnimationFrame(frame);
    const t = (performance.now() - start) * 0.001;

    if (mx >= 0) {
      smx += (mx - smx) * 0.09;
      smy += (my - smy) * 0.09;
    }

    updateCursor();

    // Rebuild texture each frame while letters are in motion
    if ((lettersAnimating || scrollVelocity > 0.5) && fontReady) {
      updateLetterAnimations();
      buildSceneTexture();
    }

    if (!sceneTex) return;

    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1i(uScene, 0);
    gl.uniform2f(uMouse, smx, smy);
    gl.uniform1f(uRadius, 0.28);
    gl.uniform1f(uStrength, 0.016);
    gl.uniform1f(uBlur, 26.0);
    gl.uniform1f(uTime, t);
    gl.uniform1f(uAspect, W / H);
    gl.uniform2f(uPx, 1.0 / W, 1.0 / H);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  frame();
})();
