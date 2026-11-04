(() => {
  const parseColor = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parseColor(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.5) return c;
      n = n.parentElement;
    }
    return { r: 11, g: 16, b: 22, a: 1 };
  };
  const figBg = { r: 11, g: 16, b: 22, a: 1 };

  const report = [];
  document.querySelectorAll('.fig').forEach(fig => {
    const figRect = fig.getBoundingClientRect();
    const issues = [];
    const textEls = Array.from(fig.querySelectorAll('h1,h2,h3,p,li,span,b,strong,div')).filter(el => {
      if (!el.textContent.trim()) return false;
      // 只取最内层文本元素
      return !Array.from(el.children).some(c => c.textContent.trim().length > 0);
    });
    let minRatio = Infinity, minEl = '';
    textEls.forEach(el => {
      const cs = getComputedStyle(el);
      const fg = parseColor(cs.color);
      if (!fg || fg.a < 0.1) return;
      let bg = bgOf(el);
      // 与容器叠加：半透明前景叠到底色
      if (fg.a < 1) {
        fg.r = fg.r * fg.a + bg.r * (1 - fg.a);
        fg.g = fg.g * fg.a + bg.g * (1 - fg.a);
        fg.b = fg.b * fg.a + bg.b * (1 - fg.a);
      }
      const r = ratio(fg, bg);
      if (r < minRatio) { minRatio = r; minEl = el.textContent.trim().slice(0, 22); }
      const size = parseFloat(cs.fontSize);
      const bold = parseInt(cs.fontWeight, 10) >= 700;
      const need = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
      if (r < need) issues.push(`对比度 ${r.toFixed(2)} < ${need}: "${el.textContent.trim().slice(0, 26)}" (${size}px/${cs.fontWeight})`);
    });

    // 溢出容器
    Array.from(fig.querySelectorAll('*')).forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const cs = getComputedStyle(el);
      if (cs.position === 'absolute' && (el.className || '').toString().includes('glow')) return;
      if (el.tagName === 'SVG' || el.closest('svg')) return;
      if (r.right > figRect.right + 1 || r.bottom > figRect.bottom + 1 || r.left < figRect.left - 1 || r.top < figRect.top - 1) {
        const tag = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).join('.') : '');
        issues.push(`越界: ${tag} [${Math.round(r.left - figRect.left)},${Math.round(r.top - figRect.top)} ${Math.round(r.width)}x${Math.round(r.height)}]`);
      }
    });

    // 文字元素之间的重叠（排除父子）
    const boxes = textEls.map(el => ({ el, r: el.getBoundingClientRect() })).filter(o => o.r.width > 0);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (ox > 4 && oy > 4) {
          issues.push(`文字重叠: "${a.el.textContent.trim().slice(0, 14)}" 与 "${b.el.textContent.trim().slice(0, 14)}" 重叠 ${Math.round(ox)}x${Math.round(oy)}px`);
        }
      }
    }

    report.push({ id: fig.id, size: `${Math.round(figRect.width)}x${Math.round(figRect.height)}`, minContrast: +minRatio.toFixed(2), minEl, issues });
  });
  return report;
})()
