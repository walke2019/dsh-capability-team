    // Pixel office stage. Stage surfaces, text, borders, and state colors derive from host --dsw-* tokens via local aliases.
    const STAGE_CSS = `
.ctm-stage{--aw-bg:var(--dsw-alias-bg-layer-1);--aw-fg:var(--dsw-alias-label-primary);--aw-muted:var(--dsw-alias-label-secondary);--aw-line:var(--dsw-alias-border-l2);--ctm-stage-floor-a:var(--dsw-alias-bg-layer-1);--ctm-stage-floor-b:var(--dsw-alias-bg-module-platform);--ctm-stage-grout:var(--dsw-alias-border-l1);--ctm-stage-wall:var(--dsw-alias-bg-overlay);--ctm-stage-desk:var(--dsw-alias-illustration-backing);--ctm-stage-desk-top:var(--dsw-alias-illustration-surface);--ctm-stage-plate:var(--dsw-alias-bg-layer-2);--ctm-stage-select:var(--dsw-alias-state-warn-primary);display:flex;flex-direction:column;gap:6px;min-width:0;container:ctm-stage/inline-size}
.ctm-stage-head{display:flex;align-items:center;gap:8px;min-width:0}
.ctm-stage-head .ctm-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctm-stage-toggle{margin-left:auto;flex:none}
.ctm-stage-office{position:relative;width:100%;height:clamp(220px,34vh,340px);border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);overflow:hidden;background:var(--ctm-stage-floor-a);user-select:none}
.ctm-stage-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;image-rendering:pixelated}
.ctm-stage-overlay{position:absolute;inset:0;pointer-events:none}
.ctm-stage-overlay>*{pointer-events:auto}
.ctm-stage-empty{position:absolute;left:50%;top:55%;transform:translate(-50%,-50%);margin:0;padding:6px 12px;border-radius:var(--dsw-radius-md);background:var(--ctm-stage-plate);color:var(--aw-muted);text-align:center;max-width:80%}
.ctm-stage-plate{position:absolute;z-index:1;transform:translate(-50%,0);display:flex;flex-direction:column;gap:3px;min-width:72px;max-width:var(--pw,150px);padding:3px 7px;border:.5px solid var(--aw-line);border-radius:var(--dsw-radius-sm);background:var(--ctm-stage-plate);color:var(--aw-fg);backdrop-filter:blur(6px);box-shadow:var(--dsw-shadow-lv2);font-size:var(--dsw-font-xxxs-11-font-size);line-height:15px;text-align:left;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.ctm-stage-plate:hover{border-color:var(--dsw-alias-border-l4);z-index:3}
.ctm-stage-plate:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.ctm-stage-plate[aria-selected=true]{border-color:var(--ctm-accent);box-shadow:0 0 0 1px var(--ctm-accent),var(--dsw-shadow-lv2);z-index:3}
.ctm-stage-plate[data-status=inactive]{opacity:.62;border-style:dashed}
.ctm-stage-plate-name{display:flex;align-items:center;gap:5px;font-size:var(--dsw-font-xxs-12-font-size);font-weight:600;line-height:16px;white-space:nowrap;min-width:0}
.ctm-stage-plate-name>span{flex:none;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.ctm-stage-plate-more{display:none;flex-direction:column;gap:3px;min-width:0}
.ctm-stage-plate-more .ctm-sub{color:var(--aw-muted)}
.ctm-stage-plate:hover .ctm-stage-plate-more,.ctm-stage-plate[aria-selected=true] .ctm-stage-plate-more{display:flex}
.ctm-stage-plate .ctm-model-badge{align-self:flex-start;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctm-stage-plate .ctm-model-badge[data-flash]{animation:ctm-stage-flash .35s 4}
.ctm-stage-plate-task{color:var(--aw-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ctm-stage-open{align-self:flex-start;padding:1px 8px;font-size:var(--dsw-font-xxxs-11-font-size);border-color:var(--dsw-alias-border-l3);color:var(--aw-fg)}
.ctm-stage-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.ctm-stage-dot[data-s=running]{background:var(--dsw-alias-state-success-primary,#3ddc84);box-shadow:0 0 6px var(--dsw-alias-state-success-primary,#3ddc84);animation:ctm-stage-blink 1.4s infinite}
.ctm-stage-dot[data-s=provisioning]{background:var(--ctm-accent)}
.ctm-stage-dot[data-s=failed]{background:var(--dsw-alias-state-error-primary,#ff5c5c)}
.ctm-stage-meter{flex:1 1 24px;min-width:18px;max-width:48px;height:5px;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-border-l2);overflow:hidden}
.ctm-stage-meter>i{display:block;height:100%;width:var(--p);background:var(--ctm-accent);transition:width .5s ease}
.ctm-stage-meter[data-tone=warn]>i{background:var(--dsw-alias-state-warn-primary,#f5a524)}
.ctm-stage-meter[data-tone=error]>i{background:var(--dsw-alias-state-error-primary,#ff5c5c)}
.ctm-stage-icon{position:absolute;transform:translate(-50%,-100%);font-size:var(--dsw-font-s-14-font-size);line-height:1;filter:drop-shadow(0 1px 1px var(--dsw-alias-bg-mask-1));animation:ctm-stage-float 1.6s ease-in-out infinite}
.ctm-stage-bubble{position:absolute;z-index:2;transform:translate(-50%,-100%);max-width:180px;padding:3px 8px;border-radius:var(--dsw-radius-md);background:var(--ctm-stage-plate);border:.5px solid var(--dsw-alias-border-l3);color:var(--aw-fg);font-size:var(--dsw-font-xxxs-11-font-size);line-height:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ctm-stage-plate-act{font-size:10.5px;line-height:14px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ctm-stage-plate-act:empty{display:none}
.ctm-stage-plate[data-act=thinking] .ctm-stage-plate-act,.ctm-stage-plate[data-act=writing] .ctm-stage-plate-act,.ctm-stage-plate[data-act=reading] .ctm-stage-plate-act,.ctm-stage-plate[data-act=searching] .ctm-stage-plate-act,.ctm-stage-plate[data-act=browsing] .ctm-stage-plate-act{color:var(--dsw-alias-link)}
.ctm-stage-plate[data-act=terminal] .ctm-stage-plate-act{color:var(--dsw-alias-state-success-primary)}
.ctm-stage-plate[data-act=messaging] .ctm-stage-plate-act,.ctm-stage-plate[data-act=board] .ctm-stage-plate-act{color:var(--dsw-alias-state-warn-primary)}
.ctm-stage-plate[data-act=waiting] .ctm-stage-plate-act{color:var(--dsw-alias-label-secondary)}
.ctm-stage-plate[data-act=failed]{border-color:var(--dsw-alias-state-error-primary,#ff5c5c)}
.ctm-stage-plate[data-act=failed] .ctm-stage-plate-act{color:var(--dsw-alias-state-error-secondary)}
.ctm-stage-icon[data-act=thinking]{animation:ctm-stage-pulse 1.2s ease-in-out infinite}
.ctm-stage-icon[data-act=waiting]{animation:ctm-stage-sway 2s ease-in-out infinite}
.ctm-stage-icon[data-act=failed]{animation:ctm-stage-shake .5s 3}
.ctm-stage-icon[data-act=done]{animation:ctm-stage-pop .5s ease-out}
.ctm-stage-bubble[data-act=failed]{border-color:var(--dsw-alias-state-error-primary,#ff5c5c);color:var(--dsw-alias-state-error-primary)}
.ctm-stage-bubble[data-act=done]{border-color:var(--dsw-alias-state-success-primary,#3ddc84)}
.ctm-stage-bubble[data-act=thinking]{font-style:italic}
.ctm-stage-detail{display:flex;flex-direction:column;gap:6px;min-width:0}
.ctm-stage-detail-head{display:flex;align-items:center;gap:8px;min-width:0}
.ctm-stage-detail-head .ctm-btn{margin-left:auto;flex:none}
.ctm-stage-detail-hint{margin:0;padding:6px 10px;border:.5px dashed var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);text-align:center}
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
