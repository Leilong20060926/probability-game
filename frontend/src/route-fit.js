// Fit the complete game into its frame. Resize/re-render never resets game state.
export function fittedSize(width,height,minWidth,minHeight) {
  const scale=Math.min(1,width/minWidth,height/minHeight);
  return {scale,width:width/scale,height:height/scale};
}

export function mountViewportFit(frame,{ResizeObserverClass=globalThis.ResizeObserver,events=globalThis}={}) {
  function update() {
    const width=frame.clientWidth,height=frame.clientHeight,game=frame.querySelector('.route-game');
    if(!game || !(width>0 && height>0))return;
    const mobile=width<=620;
    let minHeight=mobile?780:640;
    const minWidth=mobile?360:900;
    // Measure at the available virtual width, then fit any remaining intrinsic
    // height (wrapped labels, notices, old-game controls) without clipping it.
    for(let pass=0;pass<4;pass++) {
      const fit=fittedSize(width,height,minWidth,minHeight);
      game.style.width=fit.width+'px';game.style.height=fit.height+'px';
      game.style.transform=`scale(${fit.scale})`;
      const layout=game.querySelector('.route-layout'),header=game.querySelector('.route-header');
      const required=(layout?.scrollHeight||0)+(header?.offsetHeight||0);
      const status=game.querySelector('.route-status');
      const overflow=status?Math.max(0,status.scrollHeight-status.clientHeight):0;
      const needed=Math.max(required,fit.height+overflow);
      if(needed<=fit.height+1)break;
      minHeight=needed+2;
    }
  }
  const observer=ResizeObserverClass?new ResizeObserverClass(update):null;
  observer?.observe(frame);
  events.addEventListener?.('resize',update);
  // Fonts can finish loading after the initial DOM measurement.
  globalThis.document?.fonts?.ready.then(update);
  return {update,dispose(){observer?.disconnect();events.removeEventListener?.('resize',update);}};
}
