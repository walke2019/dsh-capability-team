    // Pixel office stage. Floor/desk colours are plain values (canvas reads them through getComputedStyle, which does not
    // resolve color-mix inside custom properties); everything else uses host tokens like the rest of the pane.
    const STAGE_CSS = `
.ctm-stage{--ctm-stage-floor-a:#1c1d26;--ctm-stage-floor-b:#202130;--ctm-stage-grout:rgba(0,0,0,.22);--ctm-stage-wall:#2a2b3a;--ctm-stage-desk:#3b2f26;--ctm-stage-desk-top:#5a4535;--ctm-stage-plate:rgba(10,10,14,.82);display:flex;flex-direction:column;gap:6px;min-width:0;container:ctm-stage/inline-size}
@media (prefers-color-scheme:light){.ctm-stage{--ctm-stage-floor-a:#d9d7e6;--ctm-stage-floor-b:#cfcde0;--ctm-stage-grout:rgba(0,0,0,.08);--ctm-stage-wall:#b9b7cc;--ctm-stage-desk:#8a6a52;--ctm-stage-desk-top:#b08a6a;--ctm-stage-plate:rgba(14,14,20,.84)}}
.ctm-stage-head{display:flex;align-items:center;gap:8px;min-width:0}
.ctm-stage-head .ctm-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctm-stage-toggle{margin-left:auto;flex:none}
.ctm-stage-office{position:relative;width:100%;height:clamp(220px,34vh,340px);border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;background:var(--ctm-stage-floor-a);user-select:none}
.ctm-stage-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;image-rendering:pixelated}
.ctm-stage-overlay{position:absolute;inset:0;pointer-events:none}
.ctm-stage-overlay>*{pointer-events:auto}
.ctm-stage-empty{position:absolute;left:50%;top:55%;transform:translate(-50%,-50%);margin:0;padding:6px 12px;border-radius:8px;background:var(--ctm-stage-plate);color:#d8d8e0;text-align:center;max-width:80%}
.ctm-stage-plate{position:absolute;z-index:1;transform:translate(-50%,0);display:flex;flex-direction:column;gap:3px;min-width:72px;max-width:var(--pw,150px);padding:3px 7px;border:.5px solid rgba(255,255,255,.14);border-radius:7px;background:var(--ctm-stage-plate);color:#f4f4f6;backdrop-filter:blur(6px);box-shadow:0 2px 10px rgba(0,0,0,.35);font-size:11px;line-height:15px;text-align:left;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.ctm-stage-plate:hover{border-color:rgba(255,255,255,.4);z-index:3}
.ctm-stage-plate:focus-visible{outline:1px solid var(--ctm-accent);outline-offset:1px}
.ctm-stage-plate[aria-selected=true]{border-color:var(--ctm-accent);box-shadow:0 0 0 1px var(--ctm-accent),0 2px 12px rgba(0,0,0,.4);z-index:3}
.ctm-stage-plate[data-status=inactive]{opacity:.62;border-style:dashed}
.ctm-stage-plate-name{display:flex;align-items:center;gap:5px;font-size:12px;font-weight:600;line-height:16px;white-space:nowrap;min-width:0}
.ctm-stage-plate-name>span{flex:none;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.ctm-stage-plate-more{display:none;flex-direction:column;gap:3px;min-width:0}
.ctm-stage-plate-more .ctm-sub{color:#c3c3cb}
.ctm-stage-plate:hover .ctm-stage-plate-more,.ctm-stage-plate[aria-selected=true] .ctm-stage-plate-more{display:flex}
.ctm-stage-plate .ctm-model-badge{align-self:flex-start;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctm-stage-plate .ctm-model-badge[data-flash]{animation:ctm-stage-flash .35s 4}
.ctm-stage-plate-task{color:#d2d2da;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ctm-stage-open{align-self:flex-start;padding:1px 8px;font-size:11px;border-color:rgba(255,255,255,.28);color:#f4f4f6}
.ctm-stage-dot{flex:none;width:7px;height:7px;border-radius:50%;background:#9a9aa5}
.ctm-stage-dot[data-s=running]{background:var(--dsw-alias-state-success-primary,#3ddc84);box-shadow:0 0 6px var(--dsw-alias-state-success-primary,#3ddc84);animation:ctm-stage-blink 1.4s infinite}
.ctm-stage-dot[data-s=provisioning]{background:var(--ctm-accent)}
.ctm-stage-dot[data-s=failed]{background:var(--dsw-alias-state-error-primary,#ff5c5c)}
.ctm-stage-meter{flex:1 1 24px;min-width:18px;max-width:48px;height:5px;border-radius:2px;background:rgba(255,255,255,.14);overflow:hidden}
.ctm-stage-meter>i{display:block;height:100%;width:var(--p);background:var(--ctm-accent);transition:width .5s ease}
.ctm-stage-meter[data-tone=warn]>i{background:var(--dsw-alias-state-warn-primary,#f5a524)}
.ctm-stage-meter[data-tone=error]>i{background:var(--dsw-alias-state-error-primary,#ff5c5c)}
.ctm-stage-icon{position:absolute;transform:translate(-50%,-100%);font-size:14px;line-height:1;filter:drop-shadow(0 1px 1px rgba(0,0,0,.6));animation:ctm-stage-float 1.6s ease-in-out infinite}
.ctm-stage-bubble{position:absolute;z-index:2;transform:translate(-50%,-100%);max-width:180px;padding:3px 8px;border-radius:8px;background:var(--ctm-stage-plate);border:.5px solid rgba(255,255,255,.18);color:#f4f4f6;font-size:11px;line-height:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ctm-stage-plate-act{font-size:10.5px;line-height:14px;color:#c3c3cb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ctm-stage-plate-act:empty{display:none}
.ctm-stage-plate[data-act=thinking] .ctm-stage-plate-act,.ctm-stage-plate[data-act=writing] .ctm-stage-plate-act,.ctm-stage-plate[data-act=reading] .ctm-stage-plate-act,.ctm-stage-plate[data-act=searching] .ctm-stage-plate-act,.ctm-stage-plate[data-act=browsing] .ctm-stage-plate-act{color:#a9d4ff}
.ctm-stage-plate[data-act=terminal] .ctm-stage-plate-act{color:#7ff0a8}
.ctm-stage-plate[data-act=messaging] .ctm-stage-plate-act,.ctm-stage-plate[data-act=board] .ctm-stage-plate-act{color:#e6d38f}
.ctm-stage-plate[data-act=waiting] .ctm-stage-plate-act{color:#cfd8ff}
.ctm-stage-plate[data-act=failed]{border-color:var(--dsw-alias-state-error-primary,#ff5c5c)}
.ctm-stage-plate[data-act=failed] .ctm-stage-plate-act{color:#ff9a9a}
.ctm-stage-icon[data-act=thinking]{animation:ctm-stage-pulse 1.2s ease-in-out infinite}
.ctm-stage-icon[data-act=waiting]{animation:ctm-stage-sway 2s ease-in-out infinite}
.ctm-stage-icon[data-act=failed]{animation:ctm-stage-shake .5s 3}
.ctm-stage-icon[data-act=done]{animation:ctm-stage-pop .5s ease-out}
.ctm-stage-bubble[data-act=failed]{border-color:var(--dsw-alias-state-error-primary,#ff5c5c);color:#ffd0d0}
.ctm-stage-bubble[data-act=done]{border-color:var(--dsw-alias-state-success-primary,#3ddc84)}
.ctm-stage-bubble[data-act=thinking]{font-style:italic}
.ctm-stage-detail{display:flex;flex-direction:column;gap:6px;min-width:0}
.ctm-stage-detail-head{display:flex;align-items:center;gap:8px;min-width:0}
.ctm-stage-detail-head .ctm-btn{margin-left:auto;flex:none}
.ctm-stage-detail-hint{margin:0;padding:6px 10px;border:.5px dashed var(--dsw-alias-border-l1);border-radius:8px;text-align:center}
.ctm-stage-detail>.ctm-bd-card{width:100%;box-sizing:border-box}
@container ctm-stage (max-width:599px){.ctm-stage-plate{min-width:64px;padding:2px 6px}.ctm-stage-bubble{max-width:140px}}
@keyframes ctm-stage-blink{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes ctm-stage-float{0%,100%{transform:translate(-50%,-100%)}50%{transform:translate(-50%,calc(-100% - 3px))}}
@keyframes ctm-stage-flash{0%,100%{filter:none}50%{filter:brightness(1.8)}}
@keyframes ctm-stage-pulse{0%,100%{opacity:1;transform:translate(-50%,-100%) scale(1)}50%{opacity:.6;transform:translate(-50%,-100%) scale(.88)}}
@keyframes ctm-stage-sway{0%,100%{transform:translate(-50%,-100%) rotate(-12deg)}50%{transform:translate(-50%,-100%) rotate(12deg)}}
@keyframes ctm-stage-shake{0%,100%{transform:translate(-50%,-100%)}25%{transform:translate(calc(-50% - 2px),-100%)}75%{transform:translate(calc(-50% + 2px),-100%)}}
@keyframes ctm-stage-pop{0%{transform:translate(-50%,-100%) scale(.3)}70%{transform:translate(-50%,-100%) scale(1.3)}100%{transform:translate(-50%,-100%) scale(1)}}
@media (prefers-reduced-motion:reduce){.ctm-stage-icon,.ctm-stage-icon[data-act],.ctm-stage-dot[data-s=running],.ctm-stage-plate .ctm-model-badge[data-flash]{animation:none}.ctm-stage-meter>i,.ctm-stage-plate{transition:none}}
`;
