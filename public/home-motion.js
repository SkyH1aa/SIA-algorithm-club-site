/* Seek-only foreground choreography. ScrollBus owns time; the scene owns its stage. */
(() => {
  'use strict';
  const gsap=window.gsap, bus=window.ScrollBus;
  if(!gsap || !bus) return; // Readable CSS is the default, including offline failures.
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let context=null, timelines=[], unsubscribe=null;
  function seek(state=bus.state) {
    if(document.hidden) return;
    const progress=Number.isFinite(state.smoothProgress)?state.smoothProgress:state.progress;
    if(!Number.isFinite(progress)) return;
    // This is a small interior offset, never a replacement for stage transforms.
    // The compositor resolves adjacent chapter visibility and perspective itself.
    timelines.forEach(({index,timeline})=>timeline.progress(Math.max(0,1-Math.abs(progress-index)),true));
    // This page owns the only GSAP use: seeking needs no autonomous ticker.
    gsap.ticker.sleep();
  }
  function stop() {
    unsubscribe?.(); unsubscribe=null;
    context?.revert();context=null;timelines=[];
    gsap.ticker.sleep();
  }
  function start() {
    stop();
    if(reduced.matches || document.hidden || document.body.classList.contains('phone-device')) return;
    context=gsap.context(()=>{
      // Animate only dedicated inner content without a CSS transform owner.
      // Do not target hero copy, chapter-stage, section, work rows or member cards.
      const groups=[['capabilities','.cap-exhibit-heading, .cap-controls'],['gomoku','.planet-copy h3, .planet-copy p'],['projects','.project-card h3'],['join','.join-list span']];
      const ids=['home','capabilities','gomoku','members','projects','activities','join'];
      groups.forEach(([id,selector])=>{
        const targets=document.getElementById(id)?.querySelectorAll(selector);
        if(!targets?.length) return;
        const timeline=gsap.timeline({paused:true,defaults:{duration:1,ease:'power3.out'}});
        timeline.fromTo(targets,{y:12,opacity:.72},{y:0,opacity:1,stagger:{amount:.14},immediateRender:false},0);
        timelines.push({index:ids.indexOf(id),timeline});
      });
    });
    seek();unsubscribe=bus.subscribe(seek);
    // All timelines remain paused. No ticker callback, scroll handler or RAF is added.
  }
  reduced.addEventListener('change',start);
  document.addEventListener('visibilitychange',()=>document.hidden?stop():start());
  addEventListener('pagehide',stop);
  addEventListener('pageshow',start);
  start();
})();
