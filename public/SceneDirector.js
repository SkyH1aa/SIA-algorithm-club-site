(function (global) {
  'use strict';
  const THREE = global.THREE;
  if (!THREE) return;

  const chapters = [
    { id: 'core', section: 'home', camPos: [0, 0, 14], look: [0, 0, 0], fov: 55 },
    { id: 'orbit', section: 'capabilities', camPos: [3, 1, 11], look: [0, 0, 0], fov: 52 },
    { id: 'planets', section: 'gomoku', camPos: [-4, 0, 9], look: [0, 0, 0], fov: 50 },
    { id: 'asteroids', section: 'members', camPos: [0, -2, 8], look: [0, 1, 0], fov: 58 },
    { id: 'archive', section: 'projects', camPos: [5, 2, 7], look: [0, 0, 0], fov: 46 },
    { id: 'comet', section: 'activities', camPos: [0, 3, 10], look: [0, -1, 0], fov: 60 },
    { id: 'gate', section: 'join', camPos: [0, 0, 5], look: [0, 0, 0], fov: 42 }
  ];

  const vertexShader = `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `;

  // A restrained algorithmic star chart. The raymarched core gives depth;
  // the analytic layers add graph/spiral information without extra draw calls.
  const fragmentShader = `
    uniform float uTime, uScroll, uSection, uTheme, uReducedMotion, uQuality, uFocus;
    uniform vec2 uMouse, uResolution;
    varying vec2 vUv;
    #define PI 3.14159265359
    #define TAU 6.28318530718

    float hash21(vec2 p){
      p = fract(p * vec2(123.34, 345.45));
      p += dot(p, p + 34.345);
      return fract(p.x * p.y);
    }
    float hash31(vec3 p){
      p = fract(p * 0.1031);
      p += dot(p, p.yzx + 33.33);
      return fract((p.x + p.y) * p.z);
    }
    float noise3(vec3 p){
      vec3 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float n = dot(i, vec3(1.0, 57.0, 113.0));
      float a = hash21(vec2(n, n + 1.0));
      float b = hash21(vec2(n + 57.0, n + 58.0));
      float c = hash21(vec2(n + 113.0, n + 114.0));
      float d = hash21(vec2(n + 170.0, n + 171.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float fbm(vec3 p){
      float value = 0.0;
      float amp = 0.5;
      for(int i = 0; i < 3; i++){
        value += noise3(p) * amp;
        p = p * 2.03 + vec3(11.0, 7.0, 5.0);
        amp *= 0.5;
      }
      return value;
    }
    float sdSphere(vec3 p, float r){ return length(p) - r; }
    float sdBox(vec3 p, vec3 b){
      vec3 q = abs(p) - b;
      return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
    }
    float sdTorus(vec3 p, vec2 t){
      vec2 q = vec2(length(p.xz) - t.x, p.y);
      return length(q) - t.y;
    }
    float sdLink(vec3 p, vec3 a, vec3 b, float radius){
      vec3 ba = b - a;
      vec3 pa = p - a;
      float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
      return length(pa - ba * h) - radius;
    }
    float smoothMin(float a, float b, float k){
      float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
      return mix(b, a, h) - k * h * (1.0 - h);
    }
    vec2 unionScene(vec2 a, vec2 b){ return a.x < b.x ? a : b; }

    float chapterKey(float c, float v0, float v1, float v2, float v3, float v4, float v5, float v6){
      float x = clamp(c, 0.0, 5.999);
      float segment = floor(x);
      float t = smoothstep(0.0, 1.0, fract(x));
      if(segment < 0.5) return mix(v0, v1, t);
      if(segment < 1.5) return mix(v1, v2, t);
      if(segment < 2.5) return mix(v2, v3, t);
      if(segment < 3.5) return mix(v3, v4, t);
      if(segment < 4.5) return mix(v4, v5, t);
      return mix(v5, v6, t);
    }
    float chapterValue(){ return clamp(uScroll * 6.0, 0.0, 5.999); }
    float coreMorph(){ return chapterKey(chapterValue(), 0.0, 0.33, 0.52, 0.68, 0.78, 0.90, 1.0); }
    float armCount(){ return chapterKey(chapterValue(), 3.0, 4.0, 5.0, 6.0, 4.0, 5.0, 6.0); }
    float ringShape(){ return chapterKey(chapterValue(), 0.0, 0.24, 0.56, 0.90, 0.42, 0.78, 1.0); }
    float ringCount(){ return chapterKey(chapterValue(), 3.0, 5.0, 6.0, 7.0, 5.0, 6.0, 7.0); }
    float topologyValue(){ return chapterKey(chapterValue(), 0.0, 0.33, 0.66, 1.0, 0.34, 0.66, 1.0); }
    float flowValue(){ return chapterKey(chapterValue(), 0.0, 0.65, 0.34, 1.0, 0.50, 0.68, 1.0); }
    float densityValue(){ return chapterKey(chapterValue(), 0.58, 0.72, 0.84, 0.68, 0.78, 0.90, 0.96); }

    float sdLattice(vec3 p, float spacing, float thickness){
      vec3 cell = abs(fract(p / spacing + 0.5) - 0.5) * spacing;
      return min(cell.x, min(cell.y, cell.z)) - thickness;
    }

    vec3 rotateY(vec3 p, float angle){
      float c = cos(angle), s = sin(angle);
      return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
    }
    vec2 companionMap(vec3 p, vec3 center, float scale, float spin){
      vec3 q = rotateY((p - center) / scale, spin);
      float core = sdSphere(q, 0.42);
      core = smoothMin(core, sdTorus(q * vec3(1.0, 0.78, 1.0), vec2(0.62, 0.035)), 0.08);
      core = smoothMin(core, sdBox(q, vec3(0.24)), 0.08);
      return vec2(core * scale, 5.0);
    }

    vec2 sceneMap(vec3 p){
      float t = uTime * 0.10 + uScroll * 3.5;
      float az = atan(p.z, p.x);
      float flow = fbm(p * 1.35 + vec3(t * 0.15, -t * 0.11, t * 0.08));
      p += (flow - 0.5) * 0.08 * normalize(p + vec3(0.001));

      float morph = coreMorph();
      float coreIco = sdSphere(p, 0.56) + sin(az * 5.0 + p.y * 3.0) * 0.014;
      float coreTorus = sdTorus(p * vec3(1.0, 0.82, 1.0), vec2(0.82, 0.045));
      vec3 boxP = p;
      boxP.y += sin(az * 3.0 + t) * 0.035;
      float coreLattice = sdLattice(boxP, 0.34, 0.026);
      vec3 knotP = p;
      knotP.y += sin(az * 3.0 + t * 0.8) * 0.18;
      float coreKnot = sdTorus(knotP, vec2(0.66, 0.048));
      float core = mix(coreIco, coreTorus, smoothstep(0.0, 0.34, morph));
      core = mix(core, coreLattice, smoothstep(0.26, 0.70, morph));
      core = mix(core, coreKnot, smoothstep(0.62, 1.0, morph));
      core = smoothMin(core, sdBox(boxP, vec3(0.30 + morph * 0.08)), 0.10);
      vec2 result = vec2(core, 1.0);

      float shape = ringShape();
      float activeRings = ringCount();
      for(int i = 0; i < 7; i++){
        float fi = float(i);
        float radius = 0.96 + fi * (0.36 + shape * 0.035);
        vec3 ringP = p;
        ringP.x *= 1.0 + shape * (0.18 + fi * 0.018);
        ringP.y += sin(az * (2.0 + fi * 0.35) + t * (0.35 + fi * 0.04) + shape * fi) * (0.025 + shape * 0.025);
        float ring = sdTorus(ringP, vec2(radius, 0.012 + fi * 0.0018));
        float enabled = 1.0 - smoothstep(activeRings - 0.80, activeRings + 0.05, fi);
        result = unionScene(result, vec2(mix(10.0, ring, enabled), 2.0));
      }

      float topology = topologyValue();
      float nodeRadius = 1.40 + 0.18 * densityValue() + 0.10 * sin(t * 0.7);
      for(int i = 0; i < 8; i++){
        float fi = float(i);
        float a = fi / 8.0 * TAU + t * 0.12 + uScroll * 0.7;
        vec3 ringNode = vec3(cos(a) * nodeRadius, sin(fi * 1.7 + t) * 0.22, sin(a) * nodeRadius * 0.62);
        vec3 gridNode = vec3((mod(fi, 4.0) - 1.5) * 0.46, (floor(fi / 4.0) - 0.5) * 0.48, sin(fi + t) * 0.05);
        vec3 treeNode = vec3((mod(fi, 2.0) - 0.5) * (0.34 + floor(fi / 2.0) * 0.08), (floor(fi / 2.0) - 1.5) * 0.34, sin(fi * 1.3 + t) * 0.08);
        vec3 graphNode = vec3(cos(a * 1.7) * 0.72, sin(fi * 2.1 + t) * 0.30, sin(a * 1.7) * 0.38);
        vec3 node = mix(gridNode, graphNode, smoothstep(0.0, 0.33, topology));
        node = mix(node, treeNode, smoothstep(0.26, 0.66, topology));
        node = mix(node, ringNode, smoothstep(0.58, 1.0, topology));
        node *= 0.72 + densityValue() * 0.38;
        result = unionScene(result, vec2(sdSphere(p - node, 0.052), 3.0));
        vec3 nextRing = vec3(cos(a + TAU / 8.0) * nodeRadius, sin((fi + 1.0) * 1.7 + t) * 0.22, sin(a + TAU / 8.0) * nodeRadius * 0.62);
        vec3 nextGrid = vec3((mod(fi + 1.0, 4.0) - 1.5) * 0.46, (floor((fi + 1.0) / 4.0) - 0.5) * 0.48, sin(fi + 1.0 + t) * 0.05);
        vec3 nextTree = vec3((mod(fi + 1.0, 2.0) - 0.5) * (0.34 + floor((fi + 1.0) / 2.0) * 0.08), (floor((fi + 1.0) / 2.0) - 1.5) * 0.34, sin((fi + 1.0) * 1.3 + t) * 0.08);
        vec3 nextGraph = vec3(cos((a + 0.8) * 1.7) * 0.72, sin((fi + 1.0) * 2.1 + t) * 0.30, sin((a + 0.8) * 1.7) * 0.38);
        vec3 nextNode = mix(nextGrid, nextGraph, smoothstep(0.0, 0.33, topology));
        nextNode = mix(nextNode, nextTree, smoothstep(0.26, 0.66, topology));
        nextNode = mix(nextNode, nextRing, smoothstep(0.58, 1.0, topology));
        nextNode *= 0.72 + densityValue() * 0.38;
        result = unionScene(result, vec2(sdLink(p, node, nextNode, 0.012), 4.0));
      }
      // Two distant companion galaxies share the same field and draw call.
      vec3 companionA = vec3(-1.95 + sin(t * 0.025) * 0.12, 0.34 + cos(t * 0.031) * 0.06, -0.90);
      vec3 companionB = vec3(2.05 + cos(t * 0.021) * 0.14, -0.40 + sin(t * 0.028) * 0.08, -1.10);
      result = unionScene(result, companionMap(p, companionA, 0.78, t * 0.18));
      result = unionScene(result, companionMap(p, companionB, 0.62, -t * 0.14));
      return result;
    }

    vec3 normalAt(vec3 p){
      vec2 e = vec2(0.0015, 0.0);
      return normalize(vec3(
        sceneMap(p + e.xyy).x - sceneMap(p - e.xyy).x,
        sceneMap(p + e.yxy).x - sceneMap(p - e.yxy).x,
        sceneMap(p + e.yyx).x - sceneMap(p - e.yyx).x
      ));
    }

    vec3 dayPalette(float role){
      vec3 graphite = vec3(0.055, 0.075, 0.12);
      vec3 copper = vec3(0.78, 0.20, 0.045);
      vec3 amber = vec3(0.98, 0.48, 0.08);
      if(role < 1.5) return mix(graphite, copper, 0.72);
      if(role < 2.5) return mix(graphite, amber, 0.78);
      if(role < 3.5) return mix(copper, amber, 0.55);
      return mix(graphite, copper, 0.58);
    }
    vec3 nightPalette(float role){
      vec3 deep = vec3(0.012, 0.025, 0.065);
      vec3 cyan = vec3(0.12, 0.60, 0.96);
      vec3 violet = vec3(0.46, 0.30, 0.94);
      if(role < 1.5) return mix(deep, cyan, 0.70);
      if(role < 2.5) return mix(cyan, violet, 0.30);
      if(role < 3.5) return mix(cyan, violet, 0.58);
      return mix(deep, cyan, 0.64);
    }
    vec3 roleColor(float role){ return mix(dayPalette(role), nightPalette(role), uTheme); }

    float orbitLine(vec2 p, float radius, float eccentricity, float phase){
      vec2 q = p;
      q.x *= 1.0 + eccentricity;
      q = mat2(cos(phase), -sin(phase), sin(phase), cos(phase)) * q;
      float rr = length(q);
      float wobble = sin(atan(q.y, q.x) * 3.0 + phase * 2.0 + uTime * 0.08) * 0.018;
      return 1.0 - smoothstep(0.0, 0.018, abs(rr - radius + wobble));
    }
    float spiralLine(vec2 p, float phase){
      float radius = length(p);
      float angle = atan(p.y, p.x);
      float wave = sin(angle * 3.0 + radius * 2.1 - phase);
      float width = 0.035 + radius * 0.012;
      return 1.0 - smoothstep(0.0, width, abs(wave) * 0.11 * (0.45 + radius * 0.14));
    }
    float dynamicArms(vec2 p, float count, float sweep, float density){
      float radius = length(p);
      float angle = atan(p.y, p.x);
      float wave = 0.5 + 0.5 * cos(count * angle + radius * (2.0 + density * 1.6) - sweep);
      float line = pow(max(wave, 0.0), 3.0 + density * 6.0);
      float envelope = smoothstep(0.06, 0.20, radius) * (1.0 - smoothstep(0.92, 1.65, radius));
      return line * envelope;
    }
    float graphLine(vec2 p, vec2 a, vec2 b){
      vec2 ba = b - a;
      float h = clamp(dot(p - a, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
      return 1.0 - smoothstep(0.005, 0.018, length(p - mix(a, b, h)));
    }
    float graphNodes(vec2 p, float t){
      float value = 0.0;
      for(int i = 0; i < 7; i++){
        float fi = float(i);
        float a = fi / 7.0 * TAU + t * 0.10;
        vec2 node = vec2(cos(a), sin(a) * 0.52) * (0.31 + 0.035 * sin(fi * 2.7));
        value = max(value, 1.0 - smoothstep(0.008, 0.026, length(p - node)));
      }
      return value;
    }
    float topologyNodes(vec2 p, float t, float topology){
      float value = 0.0;
      for(int i = 0; i < 8; i++){
        float fi = float(i);
        float a = fi / 8.0 * TAU + t * 0.10;
        vec2 gridNode = vec2(mod(fi, 4.0) - 1.5, floor(fi / 4.0) - 0.5) * vec2(0.09, 0.12);
        vec2 graphNode = vec2(cos(a * 1.7) * 0.17, sin(fi * 2.1 + t) * 0.12);
        vec2 treeNode = vec2((mod(fi, 2.0) - 0.5) * (0.08 + floor(fi / 2.0) * 0.018), (floor(fi / 2.0) - 1.5) * 0.085);
        vec2 ringNode = vec2(cos(a), sin(a) * 0.52) * 0.24;
        vec2 node = mix(gridNode, graphNode, smoothstep(0.0, 0.33, topology));
        node = mix(node, treeNode, smoothstep(0.26, 0.66, topology));
        node = mix(node, ringNode, smoothstep(0.58, 1.0, topology));
        value = max(value, 1.0 - smoothstep(0.008, 0.025, length(p - node)));
      }
      return value;
    }
    float clusterField(vec2 p, float t){
      float value = 0.0;
      for(int i = 0; i < 10; i++){
        float fi = float(i);
        float a = fi / 10.0 * TAU + 0.18 * sin(t * 0.05);
        vec2 center = vec2(cos(a), sin(a) * 0.56) * (0.76 + 0.08 * sin(fi * 1.9));
        float radius = 0.026 + 0.008 * sin(fi * 2.1 + t);
        float cluster = 1.0 - smoothstep(radius, radius * 3.5, length(p - center));
        float flecks = 0.5 + 0.5 * sin((p.x + p.y) * 48.0 + fi * 3.7 + t * 0.22);
        value = max(value, cluster * (0.35 + flecks * 0.45));
      }
      return value;
    }

    vec4 lowField(vec2 p, float t){
      float radial = length(p);
      float spiral = dynamicArms(p * vec2(1.0, 0.74), armCount(), t * 0.55 + uScroll * 2.0, densityValue());
      float rings = 0.0;
      for(int i = 0; i < 7; i++){
        float fi = float(i);
        float enabled = 1.0 - smoothstep(ringCount() - 0.80, ringCount() + 0.05, fi);
        rings = max(rings, orbitLine(p, 0.18 + fi * (0.10 + ringShape() * 0.02), 0.12 + ringShape() * 0.18, t * 0.03 + fi * 0.14) * enabled);
      }
      float topology = topologyNodes(p, t, topologyValue());
      float lattice = 1.0 - smoothstep(0.012, 0.036, abs(fract(p.x * 8.0 + t * 0.03) - 0.5));
      lattice *= 1.0 - smoothstep(0.18, 0.72, radial);
      float field = max(spiral * 0.52, rings * 0.55);
      field = max(field, topology * 0.18);
      field = max(field, lattice * 0.12);
      vec3 baseDay = vec3(0.94, 0.95, 0.97);
      vec3 baseNight = vec3(0.004, 0.009, 0.026);
      vec3 base = mix(baseDay, baseNight, uTheme);
      vec3 ink = roleColor(2.0);
      vec3 color = mix(base, ink, field * (uTheme > 0.5 ? 0.66 : 0.34));
      float vignette = smoothstep(0.98, 0.12, radial);
      return vec4(color, (0.10 + 0.16 * vignette) * (uTheme > 0.5 ? 0.82 : 0.48));
    }

    void main(){
      vec2 uv = vUv - 0.5;
      uv.x *= uResolution.x / max(uResolution.y, 1.0);
      float motion = 1.0 - uReducedMotion;
      float t = uTime * motion;
      vec2 mouse = (uMouse - 0.5) * vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
      vec2 p2 = uv - mouse * 0.055;
      float radius2 = dot(p2, p2);
      // A subtle gravitational lens around the algorithm core.
      float distortion = 0.035 + coreMorph() * 0.055 + uScroll * 0.018;
      p2 *= 1.0 + exp(-radius2 * 5.5) * distortion;
      float flowMode = flowValue();
      vec2 radialFlow = normalize(p2 + vec2(0.0001)) * (0.5 + flowMode * 0.8);
      vec2 vortexFlow = vec2(-p2.y, p2.x) * (0.42 + flowMode * 0.32);
      vec2 curlFlow = vec2(sin(p2.y * 8.0 + t), cos(p2.x * 7.0 - t)) * 0.16;
      vec2 divergence = p2 * (flowMode > 0.72 ? -0.32 : 0.22);
      vec2 fieldFlow = mix(curlFlow, radialFlow, smoothstep(0.0, 0.34, flowMode));
      fieldFlow = mix(fieldFlow, vortexFlow, smoothstep(0.28, 0.70, flowMode));
      fieldFlow = mix(fieldFlow, divergence, smoothstep(0.64, 1.0, flowMode));
      p2 += fieldFlow * (0.018 + densityValue() * 0.016);

      if(uQuality < 0.50){
        gl_FragColor = lowField(p2, t);
        return;
      }

      vec3 ro = vec3(p2 * 2.25, 5.6 - uScroll * 0.65);
      vec3 rd = normalize(vec3(p2, -2.55));
      float travel = 0.0;
      float hit = 0.0;
      float material = 0.0;
      vec3 hitPoint = ro;
      int steps = 42;
      if(uQuality > 0.85) steps = 64;
      for(int i = 0; i < 64; i++){
        if(i >= steps) break;
        hitPoint = ro + rd * travel;
        vec2 scene = sceneMap(hitPoint);
        if(scene.x < 0.003){ hit = 1.0; material = scene.y; break; }
        travel += max(scene.x * 0.76, 0.006);
        if(travel > 11.0) break;
      }

      vec3 baseDay = vec3(0.94, 0.95, 0.975);
      vec3 baseNight = vec3(0.003, 0.007, 0.022);
      vec3 color = mix(baseDay, baseNight, uTheme);
      float alpha = mix(0.13, 0.22, uTheme);
      float arm = dynamicArms(p2 * vec2(1.0, 0.72), armCount(), t * 0.6 + uScroll * 2.6, densityValue());
      vec2 companionA = vec2(-0.72 + sin(t * 0.025) * 0.035, 0.13 + cos(t * 0.031) * 0.018);
      vec2 companionB = vec2(0.76 + cos(t * 0.021) * 0.042, -0.18 + sin(t * 0.028) * 0.025);
      float companionArms = spiralLine((p2 - companionA) * vec2(1.55, 0.82), t * 0.42 + 1.4) * 0.58;
      companionArms += spiralLine((p2 - companionB) * vec2(1.72, 0.88), -t * 0.35 + 2.2) * 0.48;
      float web = max(graphLine(p2, vec2(0.0), companionA), graphLine(p2, vec2(0.0), companionB));
      float clusters = clusterField(p2, t);
      float halo = exp(-abs(length(p2 - companionA) - 0.32) * 13.0) * 0.18;
      halo += exp(-abs(length(p2 - companionB) - 0.26) * 15.0) * 0.14;
      float rings = 0.0;
      for(int i = 0; i < 7; i++){
        float fi = float(i);
        float enabled = 1.0 - smoothstep(ringCount() - 0.80, ringCount() + 0.05, fi);
        rings = max(rings, orbitLine(p2, 0.26 + fi * (0.14 + ringShape() * 0.025), 0.13 + ringShape() * 0.22, t * 0.035 + fi * 0.18 + uScroll * 0.14 + ringShape() * fi * 0.12) * enabled);
      }
      float nodes = topologyNodes(p2, t, topologyValue());
      float edge = 0.0;
      for(int i = 0; i < 6; i++){
        float fi = float(i);
        float a = fi / 7.0 * TAU + t * 0.10;
        float b = (fi + 1.0) / 7.0 * TAU + t * 0.10;
        edge = max(edge, graphLine(p2, vec2(cos(a), sin(a) * 0.52) * 0.31, vec2(cos(b), sin(b) * 0.52) * 0.31));
      }
      rings = max(rings, orbitLine(p2 - companionA, 0.22, 0.20, t * 0.02));
      rings = max(rings, orbitLine(p2 - companionB, 0.16, 0.18, -t * 0.018));

      color = mix(color, roleColor(2.0), rings * (uTheme > 0.5 ? 0.38 : 0.22));
      color = mix(color, roleColor(3.0), (arm * 0.38 + companionArms * 0.32 + nodes * 0.32 + edge * 0.16) * (uTheme > 0.5 ? 0.78 : 0.46));
      color = mix(color, roleColor(4.0), (web * 0.10 + clusters * 0.18 + halo * 0.20) * (uTheme > 0.5 ? 0.55 : 0.26));
      if(hit > 0.5){
        vec3 normal = normalAt(hitPoint);
        float fresnel = pow(1.0 - max(dot(normal, -rd), 0.0), 2.5);
        float contour = 1.0 - smoothstep(0.0, 0.055, abs(sin((hitPoint.x + hitPoint.y + hitPoint.z) * (10.0 + coreMorph() * 7.0) + t)));
        vec3 surface = roleColor(material);
        color = mix(color, surface, 0.42 + fresnel * 0.38 + contour * 0.10);
        color += surface * fresnel * (uTheme > 0.5 ? 0.16 : 0.055);
        alpha += fresnel * (uTheme > 0.5 ? 0.16 : 0.06);
      }
      float dust = smoothstep(0.985, 1.0, hash21(vUv * uResolution + t * 0.03));
      color += roleColor(4.0) * dust * (uTheme > 0.5 ? 0.11 : 0.035);
      float vignette = smoothstep(0.98, 0.18, length(uv));
      float focus = 1.0 + uFocus * 0.16;
      gl_FragColor = vec4(color * focus, alpha * vignette);
    }
  `;

  class SceneDirector {
    constructor(canvas) {
      this.canvas = canvas;
      this.quality = global.useQualityTier ? global.useQualityTier() : { tier: 'medium', pixelRatio: 1.25 };
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.quality.pixelRatio || 1.25, 1.5));
      this.renderer.setSize(innerWidth, innerHeight, false);
      this.scene = new THREE.Scene();
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const qualityValue = this.quality.tier === 'high' ? 1.0 : this.quality.tier === 'medium' ? 0.65 : 0.25;
      const uniforms = {
        uTime: { value: 0 },
        uScroll: { value: 0 },
        uSection: { value: 0 },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uTheme: { value: document.documentElement.dataset.theme === 'dark' ? 1 : 0 },
        uReducedMotion: { value: this.reduced ? 1 : 0 },
        uQuality: { value: qualityValue },
        uFocus: { value: 0 },
        uResolution: { value: new THREE.Vector2(innerWidth, innerHeight) }
      };
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: false
      }));
      this.scene.add(this.mesh);
      this.uniforms = this.mesh.material.uniforms;
      this.progress = this.targetProgress = 0;
      this.section = this.targetSection = 0;
      this.chapterProgress = 0;
      this.mouse = new THREE.Vector2(0.5, 0.5);
      this.targetMouse = new THREE.Vector2(0.5, 0.5);
      this.time = 0;
      this.last = performance.now();
      this.frame = 0;
      this.slowFrames = 0;
      this.cameraPath = new THREE.CatmullRomCurve3(chapters.map(c => new THREE.Vector3(...c.camPos)), false, 'catmullrom', 0.55);
      this.cameraState = { position: new THREE.Vector3(), look: new THREE.Vector3(), fov: 55, roll: 0 };
      this.bind();
      this.resize();
      this.render();
      if (!this.reduced) this.loop();
    }
    bind(){
      this.onScroll = () => {
        const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
        this.targetProgress = THREE.MathUtils.clamp(scrollY / max, 0, 1);
      };
      addEventListener('scroll', this.onScroll, { passive: true });
      this.onScroll();
      addEventListener('pointermove', e => { if (e.pointerType === 'touch') return; this.targetMouse.set(e.clientX / innerWidth, 1 - e.clientY / innerHeight); }, { passive: true });
      addEventListener('club:sceneprogress', e => {
        const detail = e.detail || {};
        if (Number.isFinite(detail.progress)) this.targetProgress = detail.progress;
        if (Number.isFinite(detail.sectionIndex)) this.targetSection = detail.sectionIndex;
      });
      addEventListener('club:themechange', e => { this.uniforms.uTheme.value = e.detail?.theme === 'dark' ? 1 : 0; });
      addEventListener('zone:focus', e => { this.uniforms.uFocus.value = e.detail?.kind === 'work' ? 1 : 0.65; });
      addEventListener('resize', () => this.resize(), { passive: true });
      document.addEventListener('visibilitychange', () => {
        cancelAnimationFrame(this.frame);
        if (!document.hidden && !this.reduced) this.loop();
      });
      this.observer = new IntersectionObserver(entries => entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const index = chapters.findIndex(c => c.section === entry.target.id);
        if (index >= 0) this.targetSection = index;
      }), { threshold: 0.42 });
      chapters.forEach(chapter => {
        const element = document.getElementById(chapter.section);
        if (element) this.observer.observe(element);
      });
    }
    resize(){
      this.renderer.setSize(innerWidth, innerHeight, false);
      this.uniforms?.uResolution.value.set(innerWidth, innerHeight);
    }
    update(dt){
      this.progress = THREE.MathUtils.damp(this.progress, this.targetProgress, 2.55, dt);
      this.section = THREE.MathUtils.damp(this.section, this.targetSection, 2.2, dt);
      this.chapterProgress = this.progress * chapters.length - this.section;
      this.mouse.x = THREE.MathUtils.damp(this.mouse.x, this.targetMouse.x, 4.8, dt);
      this.mouse.y = THREE.MathUtils.damp(this.mouse.y, this.targetMouse.y, 4.8, dt);
      this.time += this.reduced ? 0 : dt;
      this.uniforms.uTime.value = this.time;
      this.uniforms.uScroll.value = this.progress;
      this.uniforms.uSection.value = this.section;
      this.uniforms.uMouse.value.copy(this.mouse);
      this.uniforms.uFocus.value = THREE.MathUtils.damp(this.uniforms.uFocus.value, 0, 2.6, dt);
      this.mesh.rotation.z = THREE.MathUtils.damp(this.mesh.rotation.z, Math.sin(this.progress * Math.PI * 2) * 0.012, 2.0, dt);
    }
    render(){ this.renderer.render(this.scene, this.camera); }
    loop(){
      const now = performance.now();
      const dt = Math.min((now - this.last) / 1000, 1 / 30);
      this.last = now;
      if (dt >= 0.026) this.slowFrames += 1;
      else this.slowFrames = Math.max(0, this.slowFrames - 2);
      if (this.slowFrames > 14 && this.uniforms.uQuality.value > 0.52) this.uniforms.uQuality.value = 0.52;
      this.update(dt);
      this.render();
      this.frame = requestAnimationFrame(() => this.loop());
    }
  }

  global.SceneDirector = SceneDirector;
  global.SceneDirector.mount = function mount(canvas){
    if (!canvas || global.__algorithmFieldDirector) return global.__algorithmFieldDirector;
    try {
      global.__algorithmFieldDirector = new SceneDirector(canvas);
      return global.__algorithmFieldDirector;
    } catch (error) {
      console.warn('SceneDirector unavailable', error);
      return null;
    }
  };
})(window);
