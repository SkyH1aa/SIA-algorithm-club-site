(() => {
  const out = { fonts: {}, clips: [], imageOverlaps: [], qr: null };
  out.fonts.misans = document.fonts.check('16px "MiSans VF"');
  out.fonts.inter = document.fonts.check('16px "Inter VF"');
  out.fonts.jbm = document.fonts.check('16px "JBM"');
  out.fonts.loadedFamilies = Array.from(document.fonts).map(f => f.family + ' ' + f.weight + ' ' + f.status).slice(0, 12);

  document.querySelectorAll('.fig').forEach(fig => {
    // 1) 元素被自身容器裁切（文字溢出自己的盒子）
    fig.querySelectorAll('h1,h2,h3,p,li,span,b,strong').forEach(el => {
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible') {
        out.clips.push(`${fig.id}: "${el.textContent.trim().slice(0, 20)}" scrollW ${el.scrollWidth} > clientW ${el.clientWidth}`);
      }
    });

    // 2) 图片与文字重叠
    const imgs = Array.from(fig.querySelectorAll('img'));
    const texts = Array.from(fig.querySelectorAll('h1,h2,h3,p,li,span,b,strong')).filter(el => el.textContent.trim());
    imgs.forEach(img => {
      const ir = img.getBoundingClientRect();
      texts.forEach(t => {
        const tr = t.getBoundingClientRect();
        const ox = Math.min(ir.right, tr.right) - Math.max(ir.left, tr.left);
        const oy = Math.min(ir.bottom, tr.bottom) - Math.max(ir.top, tr.top);
        if (ox > 6 && oy > 6) {
          out.imageOverlaps.push(`${fig.id}: img ${img.className || img.alt} 覆盖文字 "${t.textContent.trim().slice(0, 20)}" ${Math.round(ox)}x${Math.round(oy)}px`);
        }
      });
    });
  });

  // 3) 二维码完整性
  const qr = document.querySelector('#fig-join .qrbox img');
  if (qr) {
    const r = qr.getBoundingClientRect();
    const box = qr.parentElement.getBoundingClientRect();
    out.qr = {
      natural: `${qr.naturalWidth}x${qr.naturalHeight}`,
      rendered: `${Math.round(r.width)}x${Math.round(r.height)}`,
      fullyInsideBox: r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom,
      aspectKept: Math.abs((r.width / r.height) - (qr.naturalWidth / qr.naturalHeight)) < 0.02
    };
  }

  // 4) 页面是否有横向滚动
  out.horizontalOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;

  // 5) 字体实际渲染用的家族
  const h1 = document.querySelector('#fig-square h1');
  out.h1Font = getComputedStyle(h1).fontFamily;
  const sample = document.querySelector('#fig-paths .card p');
  out.pFont = getComputedStyle(sample).fontFamily;

  return out;
})()
