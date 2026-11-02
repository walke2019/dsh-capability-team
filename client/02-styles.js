    const CSS = `
.ctm-card{display:flex;flex-direction:column}
.ctm-row{position:relative;display:flex;align-items:center;min-width:0;height:calc(24px + var(--dsh-content-font-delta,0px));overflow:hidden;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));transition:color .1s}
.ctm-row:hover,.ctm-row[data-open]{color:var(--dsw-alias-label-secondary)}
.ctm-row[data-expandable]{cursor:pointer}
.ctm-row:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:-1px;border-radius:4px}
.ctm-lead{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;width:calc(16px + var(--dsh-content-font-delta,0px));height:calc(16px + var(--dsh-content-font-delta,0px));margin-right:6px}
.ctm-lead svg{width:calc(14px + var(--dsh-content-font-delta,0px));height:calc(14px + var(--dsh-content-font-delta,0px))}
.ctm-ico{display:inline-flex;transition:opacity .1s}
.ctm-chev{position:absolute;inset:0;display:inline-flex;align-items:center;justify-content:center;opacity:0;transition:opacity .1s}
.ctm-row[data-expandable]:hover .ctm-ico,.ctm-row[data-open] .ctm-ico{opacity:0}
.ctm-row[data-expandable]:hover .ctm-chev,.ctm-row[data-open] .ctm-chev{opacity:1}
.ctm-title{flex:none;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px))}
.ctm-sep{flex:none;width:2px;height:2px;margin:0 8px;border-radius:1px;background:var(--dsw-alias-label-caption,currentColor)}
.ctm-summary{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px))}
.ctm-badge{flex:none;margin-left:8px;padding:0 6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ctm-badge[data-tone=brand]{color:var(--dsw-alias-brand-primary);border-color:currentColor}
.ctm-badge[data-tone=success]{color:var(--dsw-alias-state-success-primary);border-color:currentColor}
.ctm-badge[data-tone=warn]{color:var(--dsw-alias-state-warn-primary);border-color:currentColor}
.ctm-error{color:var(--dsw-alias-state-error-primary)}
.ctm-warn{color:var(--dsw-alias-state-warn-primary)}
.ctm-card[data-state=running] .ctm-summary,.ctm-card[data-state=preparing] .ctm-title{animation:ctm-pulse 1.4s ease-in-out infinite}
@keyframes ctm-pulse{50%{opacity:.45}}
.ctm-tc{margin-top:6px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));padding-top:6px;font-size:12px}
.ctm-tc>summary{cursor:pointer;display:flex;gap:8px;align-items:baseline;list-style:none}
.ctm-tc>summary::-webkit-details-marker{display:none}
.ctm-tc-body,.ctm-tc-actions,.ctm-tc-confirm,.ctm-tc-audit{display:flex;flex-direction:column;gap:6px;margin-top:6px}
.ctm-tc-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.ctm-tc-override{display:flex;flex-direction:column;gap:2px}
.ctm-tc-reason,.ctm-tc select{font:inherit;padding:3px 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.35));background:transparent;color:inherit;max-width:100%}
.ctm-tc-confirm{padding:8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.35))}
.ctm-tc-audit ul{margin:0;padding-left:16px;display:flex;flex-direction:column;gap:2px}
.ctm-mc-list{display:flex;flex-direction:column;gap:6px}
.ctm-mc-item{padding-left:8px;border-left:2px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25))}
.ctm-mc-results{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px}
.ctm-mc-results li{display:flex;flex-direction:column;gap:1px;min-width:0;overflow-wrap:anywhere}
.ctm-dc{display:flex;flex-direction:column;gap:12px;padding:12px 14px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));font-size:12px;line-height:1.5}
.ctm-dc-head{display:flex;flex-direction:column;gap:2px}
.ctm-dc-title{font-size:13px}
.ctm-dc-roles{display:flex;flex-direction:column;gap:10px}
.ctm-dc-role{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06))}
.ctm-dc-role-head{display:flex;align-items:center;gap:10px;min-width:0}
.ctm-dc-avatar{flex:none;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-weight:600;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.18))}
.ctm-dc-who{display:flex;flex-direction:column;gap:1px;min-width:0}
.ctm-dc-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary,inherit);font-size:11px}
.ctm-dc-meta code{font-size:11px}
.ctm-dc-task{display:flex;flex-direction:column;align-items:flex-start;gap:2px}
.ctm-dc-task p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.ctm-dc-task p[data-clamped]{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ctm-dc-link{font:inherit;font-size:11px;padding:0;border:0;background:none;color:var(--dsw-alias-link);cursor:pointer}
.ctm-dc-grid{display:grid;grid-template-columns:76px minmax(0,1fr);gap:8px 10px;align-items:start}
.ctm-dc-key{padding-top:6px;display:flex;gap:4px;align-items:baseline}
.ctm-dc-count{font-weight:400;font-variant-numeric:tabular-nums;opacity:.7}
.ctm-dc-fallbacks{display:flex;flex-direction:column;gap:6px;min-width:0}
.ctm-dc-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}
.ctm-dc-item{display:grid;grid-template-columns:18px minmax(0,1fr) auto;align-items:center;gap:6px;padding:3px 4px 3px 6px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25))}
.ctm-dc-index{font-variant-numeric:tabular-nums;opacity:.6;text-align:center}
.ctm-dc-route{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctm-dc-actions{display:flex;gap:2px}
.ctm-dc-icon{font:inherit;line-height:1;width:22px;height:22px;border-radius:5px;border:0;background:transparent;color:inherit;cursor:pointer}
.ctm-dc-icon:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.15))}
.ctm-dc-icon:disabled{opacity:.3;cursor:default}
.ctm-dc-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))}
.ctm-dc-scope{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.ctm-dc-seg{display:inline-flex;padding:2px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.ctm-dc-segbtn{font:inherit;font-size:12px;padding:3px 10px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
.ctm-dc-segbtn[aria-checked=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent);font-weight:600}
.ctm-dc-buttons{display:flex;gap:8px;margin-left:auto}
.ctm-dc-wrap{display:flex;flex-direction:column;gap:6px}
.ctm-mp{position:relative;min-width:0}
.ctm-mp-input{box-sizing:border-box;width:100%;font:inherit;font-size:12px;padding:5px 26px 5px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.ctm-mp-input:focus{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color);outline-offset:-1px}
.ctm-mp-caret{position:absolute;right:8px;top:50%;transform:translateY(-50%);pointer-events:none;opacity:.6}
.ctm-mp-pop{position:absolute;z-index:1100;left:0;right:0;top:calc(100% + 4px);border-radius:var(--dsw-radius-lg,10px);background-color:var(--dsw-alias-bg-base);background-image:linear-gradient(var(--dsw-specific-menu),var(--dsw-specific-menu));box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);overflow:hidden}
.ctm-mp-count{padding:5px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))}
.ctm-mp-list{list-style:none;margin:0;padding:4px 0;max-height:240px;overflow:auto}
.ctm-mp-group{padding:6px 10px 2px;font-size:11px;font-weight:600;opacity:.65;text-transform:none}
.ctm-mp-option{display:flex;justify-content:space-between;gap:8px;padding:5px 10px 5px 16px;cursor:pointer}
.ctm-mp-option[data-active]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.15))}
.ctm-mp-option[aria-selected=true]{font-weight:600}
.ctm-mp-model{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctm-mp-empty{padding:10px}
@media (max-width:420px){.ctm-dc-grid{grid-template-columns:minmax(0,1fr)}.ctm-dc-key{padding-top:0}}
.ctm-plan-board{margin:6px 0 0;padding-left:16px;display:flex;flex-direction:column;gap:2px;font-size:12px}
@media (prefers-reduced-motion:reduce){.ctm-card .ctm-summary,.ctm-card .ctm-title{animation:none!important}}
.ctm-wrap{display:flex;flex-direction:column}
.ctm-body{display:flex;flex-direction:column;margin:4px 0 4px 4px;overflow:hidden;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,8px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size-secondary,13px)}
.ctm-section{display:flex;flex-direction:column;gap:6px;padding:8px 12px;min-width:0}
.ctm-section+.ctm-section{border-top:.5px solid var(--dsw-alias-border-l2)}
.ctm-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.ctm-text{white-space:pre-wrap;word-break:break-word;line-height:1.6}
.ctm-pre{margin:0;max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:inherit;line-height:1.6}
.ctm-pre[data-short]{max-height:120px}
.ctm-grid{display:grid;grid-template-columns:max-content minmax(0,1fr);column-gap:16px;row-gap:8px;align-items:baseline}
.ctm-grid3{display:grid;grid-template-columns:max-content max-content minmax(0,1fr);column-gap:16px;row-gap:6px;align-items:baseline}
.ctm-who{display:flex;flex-direction:column;min-width:0}
.ctm-name{font-weight:500}
.ctm-sub{font-size:12px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.ctm-chips{display:flex;flex-wrap:wrap;gap:6px}
.ctm-chip{display:inline-flex;gap:4px;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:20px}
.ctm-chip>span:first-child{color:var(--dsw-alias-label-secondary)}
.ctm-list{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.ctm-link{padding:0;border:none;background:none;color:var(--dsw-alias-brand-primary);font:inherit;text-align:left;word-break:break-all;cursor:pointer}
.ctm-link:hover{text-decoration:underline}
.ctm-inspect{align-self:flex-start;margin:0 0 4px 4px;padding:2px 4px;border:none;border-radius:4px;background:none;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}
.ctm-inspect:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.ctm-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.ctm-badge[data-tone=error]{color:var(--dsw-alias-state-error-primary);border-color:currentColor}
.ctm-success{color:var(--dsw-alias-state-success-primary)}
.ctm-btn{flex:none;padding:3px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;transition:background .12s,color .12s,border-color .12s}
.ctm-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.ctm-btn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.ctm-btn:disabled{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);cursor:default}
.ctm-btn[data-primary]{border-color:var(--dsw-alias-button-primary-fill);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);font-weight:500}
.ctm-btn[data-primary]:hover:not(:disabled){border-color:var(--dsw-alias-button-primary-hover);background:var(--dsw-alias-button-primary-hover)}
.ctm-btn[data-primary]:active:not(:disabled){opacity:.85}
.ctm-btn[data-primary]:disabled{border-color:transparent;background:var(--dsw-alias-button-primary-dimmed);color:var(--dsw-alias-label-tertiary)}
.ctm-btn:focus-visible,.ctm-ov-tab:focus-visible,.ctm-switch:focus-visible,.ctm-ov-group>summary:focus-visible{outline:1px solid var(--ctm-accent);outline-offset:1px}
.ctm-card,.ctm-ov{--ctm-accent:var(--dsw-alias-state-business-primary,var(--dsw-alias-link,#4d6bfe))}
.ctm-ov .ctm-badge[data-tone=brand]{color:var(--ctm-accent)}
.ctm-ov{container:ctm-ov/inline-size;background:var(--dsw-alias-bg-base);display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size-secondary,13px)}
.ctm-ov-head{flex:none;display:flex;flex-direction:column;gap:1px;padding:8px 16px 6px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.ctm-ov-titlerow{display:flex;align-items:center;gap:6px;min-width:0}
.ctm-ov-title{margin:0;font-size:14px;font-weight:600;line-height:20px}
.ctm-ov-subrow{margin:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctm-ov-titlerow .ctm-badge{margin-left:0}
.ctm-ov-refresh{margin-left:auto}
.ctm-ov-scroll{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:12px;padding:12px 16px 24px}
.ctm-ov-scroll>*,.ctm-ov-panel>*,.ctm-ov-editor>*{flex-shrink:0}
.ctm-ov-empty{padding:24px 0;text-align:center}
.ctm-ov-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(54px,1fr));gap:6px}
.ctm-ov-stat{display:flex;flex-direction:column;gap:2px;min-width:0;padding:7px 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.ctm-ov-stat strong{font-size:18px;font-weight:600;line-height:22px}
.ctm-ov-stat span{font-size:12px;color:var(--dsw-alias-label-secondary)}
.ctm-ov-stat[data-tone=warn] strong{color:var(--dsw-alias-state-warn-primary)}
.ctm-ov-stat[data-tone=error] strong{color:var(--dsw-alias-state-error-primary)}
.ctm-ov-callout{display:flex;flex-direction:column;gap:8px;margin:0;padding:10px 12px;border-radius:8px;border:.5px solid currentColor;line-height:1.6;word-break:break-word}
.ctm-ov-callout[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}
.ctm-ov-callout[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
.ctm-ov-callout .ctm-text{color:var(--dsw-alias-label-primary)}
.ctm-ov-tabs{position:sticky;top:-12px;z-index:2;display:flex;flex-wrap:wrap;gap:2px;padding:3px;margin:0 -2px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.ctm-ov-tab{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:4px 8px;border:none;border-radius:6px;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer}
.ctm-ov-tab:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.ctm-ov-tab[aria-pressed=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:500;box-shadow:0 0 0 .5px var(--dsw-alias-border-l1)}
.ctm-ov-count{padding:0 5px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);flex:none}
@container ctm-ov (min-width:480px){.ctm-ov-tab{flex:1 1 0;min-width:0}}
.ctm-ov-subtabs{display:flex;flex-wrap:wrap;gap:2px;padding:3px;margin:0 0 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.ctm-ov-subtab{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:4px 8px;border:none;border-radius:6px;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer}
.ctm-ov-subtab:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.ctm-ov-subtab[aria-pressed=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:500;box-shadow:0 0 0 .5px var(--dsw-alias-border-l1)}
@container ctm-ov (min-width:420px){.ctm-ov-subtab{flex:1 1 0;min-width:0}}
.ctm-ov-panel{display:flex;flex-direction:column;gap:12px;min-width:0}
.ctm-ov-panel[hidden]{display:none}
.ctm-ov-block{display:flex;flex-direction:column;gap:6px;min-width:0}
.ctm-ov-help{margin:0;line-height:1.5}
.ctm-ov-note{font-size:12px}
.ctm-ov-editor{display:flex;flex-direction:column;gap:12px;min-width:0}
.ctm-ov-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:6px 0;background:var(--dsw-alias-bg-base)}
.ctm-ov-search{box-sizing:border-box;width:100%;padding:5px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.ctm-ov-search:focus{outline:1px solid var(--ctm-accent);outline-offset:-1px}
.ctm-ov-allocs{display:flex;flex-direction:column;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.ctm-ov-alloc{display:grid;grid-template-columns:minmax(56px,max-content) minmax(0,1fr);column-gap:10px;padding:6px 10px;align-items:baseline}
.ctm-ov-alloc+.ctm-ov-alloc{border-top:.5px solid var(--dsw-alias-border-l2)}
.ctm-ov-chain{display:flex;align-items:center;flex-wrap:wrap;gap:4px;min-width:0}
.ctm-ov-hop{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 7px;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,monospace);font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.ctm-ov-hop[data-primary]{border-color:var(--ctm-accent);background:none;color:var(--ctm-accent)}
.ctm-ov-arrow{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:13px;line-height:1}
.ctm-ov-tiers{display:flex;flex-wrap:wrap;gap:6px}
.ctm-ov-tier{position:relative;flex:none;display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer}
.ctm-ov-tier:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.ctm-ov-more{align-self:center}
.ctm-ov-tier[aria-selected=true]{border-color:var(--ctm-accent);color:var(--ctm-accent);font-weight:500}
.ctm-ov-tier[aria-selected=true] .ctm-ov-count{background:var(--ctm-accent);color:#fff}
.ctm-ov-tier:focus-visible{outline:1px solid var(--ctm-accent);outline-offset:1px}
.ctm-ov-offdot{position:absolute;top:1px;right:1px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary)}
.ctm-ov-list-flat{border-top:none}
.ctm-ov-rule-input{display:flex;gap:6px}
.ctm-ov-rule-input .ctm-ov-search{flex:1 1 auto;min-width:0;font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,monospace)}
.ctm-ov-rule{align-items:center;font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,monospace);border:.5px solid var(--dsw-alias-state-warn-primary)}
.ctm-ov-rule-x{margin-left:2px;padding:0 4px;border:none;border-radius:4px;background:none;color:var(--dsw-alias-label-secondary);font:inherit;line-height:18px;cursor:pointer}
.ctm-ov-rule-x:hover:not(:disabled){color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover)}
.ctm-ov-panel{container-type:inline-size}
.ctm-ov-split{display:flex;flex-direction:column;gap:16px;min-width:0}
.ctm-ov-split>*{flex-shrink:0;min-width:0}
@container (min-width:720px){.ctm-ov-split{display:grid;grid-template-columns:minmax(300px,2fr) minmax(0,3fr);align-items:start}}
.ctm-bd{display:flex;flex-direction:column;gap:8px;min-width:0}
.ctm-bd-head{display:flex;align-items:center;gap:8px}
.ctm-bd-head .ctm-badge{margin-left:0}
.ctm-bd-at{margin-left:auto;display:inline-flex;align-items:center;gap:5px}
.ctm-bd-pulse{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary);animation:ctm-beat 2.5s ease-out infinite}
@keyframes ctm-beat{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,transparent)}70%,100%{box-shadow:0 0 0 6px transparent}}
.ctm-bd-card{position:relative;display:flex;flex-direction:column;gap:6px;min-width:0;padding:9px 10px 11px;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgba(0,0,0,.05);transition:border-color .2s,box-shadow .2s,opacity .2s}
.ctm-bd-card[data-status=inactive]{opacity:.62;border-style:dashed}
.ctm-bd-card[data-open]{cursor:pointer}
.ctm-bd-card[data-open]:hover{border-color:var(--ctm-accent)}
.ctm-bd-card[data-open]:focus-visible{outline:2px solid var(--ctm-accent);outline-offset:2px}
.ctm-bd-card[data-status=failed]{border-color:var(--dsw-alias-state-error-primary)}
.ctm-bd-card[data-status=running]{border-color:var(--ctm-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--ctm-accent) 14%,transparent),0 4px 14px color-mix(in srgb,var(--ctm-accent) 18%,transparent);animation:ctm-glow 2.4s ease-in-out infinite}
@keyframes ctm-glow{50%{box-shadow:0 0 0 5px color-mix(in srgb,var(--ctm-accent) 8%,transparent),0 4px 18px color-mix(in srgb,var(--ctm-accent) 26%,transparent)}}
.ctm-bd-top{display:flex;align-items:center;gap:8px;min-width:0}
.ctm-bd-top .ctm-who{flex:1 1 0;min-width:0}
.ctm-bd-top .ctm-name,.ctm-bd-top .ctm-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctm-bd-avatar{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600;font-size:13px}
.ctm-bd-card[data-status=running] .ctm-bd-avatar{background:var(--ctm-accent);color:#fff}
.ctm-bd-card[data-status=running] .ctm-bd-avatar::after{content:'';position:absolute;inset:-4px;border-radius:50%;border:1.5px solid transparent;border-top-color:var(--ctm-accent);border-right-color:var(--ctm-accent);animation:ctm-spin 1.1s linear infinite}
@keyframes ctm-spin{to{transform:rotate(360deg)}}
.ctm-bd-state{flex:none;display:inline-flex;align-items:center;gap:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ctm-bd-state[data-tone=brand]{color:var(--ctm-accent)}
.ctm-bd-state[data-tone=success]{color:var(--dsw-alias-state-success-primary)}
.ctm-bd-state[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
.ctm-bd-dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.ctm-bd-card[data-status=running] .ctm-bd-dot,.ctm-bd-card[data-status=provisioning] .ctm-bd-dot{animation:ctm-pulse 1s ease-in-out infinite}
.ctm-bd-time{font-variant-numeric:tabular-nums;opacity:.8}
.ctm-bd-task{display:flex;align-items:baseline;gap:5px;min-width:0;font-size:12px;line-height:1.45}
.ctm-bd-subject{min-width:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.ctm-bd-model{display:flex;min-width:0}
.ctm-bd-task>.ctm-sub{flex:none}
.ctm-bd-bar{position:absolute;left:10px;right:10px;bottom:4px;height:2px;border-radius:2px;overflow:hidden;opacity:0}
.ctm-bd-card[data-status=running] .ctm-bd-bar,.ctm-bd-card[data-status=provisioning] .ctm-bd-bar{opacity:1;background:linear-gradient(90deg,transparent,var(--ctm-accent),transparent) 0 0/40% 100% no-repeat,color-mix(in srgb,var(--ctm-accent) 12%,transparent);animation:ctm-scan 1.4s ease-in-out infinite}
@keyframes ctm-scan{0%{background-position:-40% 0,0 0}100%{background-position:140% 0,0 0}}
@media (prefers-reduced-motion:reduce){.ctm-bd *,.ctm-bd *::before,.ctm-bd *::after,.ctm-bd-card{animation:none!important}}
.ctm-ov-route{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,monospace);font-size:12px}
.ctm-ov-group{border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.ctm-ov-group>summary{display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;list-style:none;user-select:none}
.ctm-ov-group>summary::-webkit-details-marker{display:none}
.ctm-ov-group>summary::before{content:'';flex:none;width:5px;height:5px;margin-right:2px;border-right:1.3px solid currentColor;border-bottom:1.3px solid currentColor;transform:rotate(-45deg);transition:transform .1s;color:var(--dsw-alias-label-secondary)}
.ctm-ov-group[open]>summary::before{transform:rotate(45deg)}
.ctm-ov-group>summary>.ctm-sub:last-child{margin-left:auto}
.ctm-ov-group>summary .ctm-badge{margin-left:0}
.ctm-ov-group>.ctm-ov-block,.ctm-ov-group>p{margin:0;padding:0 10px 10px}
.ctm-ov-list{display:flex;flex-direction:column;border-top:.5px solid var(--dsw-alias-border-l2)}
.ctm-ov-model{display:flex;align-items:flex-start;gap:10px;padding:8px 10px;cursor:pointer}
.ctm-ov-model+.ctm-ov-model{border-top:.5px solid var(--dsw-alias-border-l2)}
.ctm-ov-model:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ctm-ov-model{content-visibility:auto;contain-intrinsic-size:auto 56px}
.ctm-ov-model[data-off] .ctm-ov-model-name .ctm-name{color:var(--dsw-alias-label-secondary);text-decoration:line-through}
.ctm-ov-model-main{display:flex;flex-direction:column;gap:4px;min-width:0}
.ctm-ov-model-name{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px;min-width:0;overflow-wrap:anywhere}
.ctm-ov-model-name .ctm-badge{margin-left:0}
.ctm-switch{appearance:none;flex:none;position:relative;width:28px;height:16px;margin:2px 0 0;border-radius:999px;background:var(--dsw-alias-border-l1);cursor:pointer;transition:background .15s}
.ctm-switch::after{content:'';position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
.ctm-switch:checked{background:var(--dsw-alias-state-success-primary)}
.ctm-switch:checked::after{transform:translateX(12px)}
.ctm-switch:disabled{opacity:.5;cursor:default}
.ctm-ov-roles{display:flex;flex-direction:column;gap:8px}
.ctm-ov-role{display:flex;flex-direction:column;gap:3px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.ctm-ov-role-head{display:flex;align-items:center;gap:6px}
.ctm-ov-role-head .ctm-badge{margin-left:auto}
.ctm-ov-desc{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ctm-ov-kv{padding:8px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.ctm-ov-logs{display:flex;flex-direction:column;border-top:.5px solid var(--dsw-alias-border-l2)}
.ctm-us-meter{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.ctm-us-meter>i{display:block;height:100%;background:var(--ctm-accent)}
.ctm-us-meter[data-tone=warn]>i{background:var(--dsw-alias-state-warn-primary,#d97706)}
.ctm-us-meter[data-tone=error]>i{background:var(--dsw-alias-state-error-primary)}
.ctm-us-num{font-variant-numeric:tabular-nums}
.ctm-ov-log{display:flex;align-items:center;gap:6px;min-width:0;padding:5px 10px}
.ctm-ov-log+.ctm-ov-log{border-top:.5px solid var(--dsw-alias-border-l2)}
.ctm-ov-log .ctm-badge{margin-left:0}
.ctm-ov-log .ctm-ov-route{flex:1 1 auto}
.ctm-ov-seq{flex:none;min-width:32px;font-variant-numeric:tabular-nums}
.ctm-ov-time{flex:none;font-variant-numeric:tabular-nums;white-space:nowrap}
.ctm-bd-open-btn{position:absolute;top:7px;right:8px;z-index:2;padding:2px 7px;border:.5px solid var(--ctm-accent);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--ctm-accent);font:inherit;font-size:11px;line-height:16px;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .15s,background .12s,color .12s}
.ctm-bd-open-btn:hover{background:var(--ctm-accent);color:#fff}
.ctm-bd-card:hover .ctm-bd-open-btn,.ctm-bd-card:focus-within .ctm-bd-open-btn,.ctm-bd-open-btn:focus{opacity:1;pointer-events:auto}
@media (hover: none){.ctm-bd-open-btn{opacity:1;pointer-events:auto}}
.ctm-model-badge{display:inline-flex;align-items:center;gap:4px;font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,monospace);font-size:11px;line-height:16px;padding:1px 6px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctm-model-badge[data-grade=legendary]{color:#d97706;border-color:color-mix(in srgb,#f59e0b 50%,transparent);background:color-mix(in srgb,#f59e0b 12%,transparent)}
.ctm-model-badge[data-grade=epic]{color:#9333ea;border-color:color-mix(in srgb,#a855f7 50%,transparent);background:color-mix(in srgb,#a855f7 12%,transparent)}
.ctm-model-badge[data-grade=rare]{color:#2563eb;border-color:color-mix(in srgb,#3b82f6 50%,transparent);background:color-mix(in srgb,#3b82f6 12%,transparent)}
.ctm-model-badge[data-grade=cloth]{color:var(--dsw-alias-label-tertiary);border-color:var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 60%,transparent)}
.ctm-badge-rank{font-weight:600;font-size:10px;padding:0 3px;border-radius:3px;background:color-mix(in srgb,currentColor 15%,transparent);flex:none}
.ctm-badge-alias{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctm-bd-bubble{position:relative;display:flex;flex-direction:column;gap:3px;padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);font-size:12px;line-height:1.45;color:var(--dsw-alias-label-primary)}
.ctm-bd-bubble-head{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.ctm-bd-bubble-head .ctm-badge{margin-left:0}
.ctm-bd-bubble-body{word-break:break-word;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.ctm-bd-quote{font-style:italic;color:var(--dsw-alias-label-secondary);font-size:11px}
.ctm-bd-meters{display:flex;flex-direction:column;gap:5px;margin-top:2px}
.ctm-bd-meter-row{display:flex;flex-direction:column;gap:2px}
.ctm-bd-meter-labels{display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:var(--dsw-alias-label-secondary)}
.ctm-bd-meter-labels .ctm-us-num{font-variant-numeric:tabular-nums}
.ctm-bd-deps{display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:.5px solid var(--dsw-alias-border-l2)}
.ctm-bd-deps-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.ctm-bd-deps-chain{display:flex;align-items:center;flex-wrap:wrap;gap:4px;font-size:11px;color:var(--ctm-accent);background:color-mix(in srgb,var(--ctm-accent) 10%,transparent);padding:2px 8px;border-radius:6px;border:.5px solid color-mix(in srgb,var(--ctm-accent) 30%,transparent)}
.ctm-bd-deps-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px}
.ctm-bd-dep-node{display:flex;flex-direction:column;gap:3px;padding:6px 8px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:11px}
.ctm-bd-dep-node[data-longest]{border-color:var(--ctm-accent);box-shadow:0 0 0 1px var(--ctm-accent)}
.ctm-bd-dep-top{display:flex;align-items:center;justify-content:space-between;gap:4px}
.ctm-bd-dep-subj{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.ctm-bd-dep-blocked{font-size:10px;color:var(--dsw-alias-state-warn-primary)}
.ctm-bd-switch{font-size:10px;color:var(--ctm-accent);background:color-mix(in srgb,var(--ctm-accent) 8%,transparent);border-radius:4px;padding:2px 4px;margin-top:2px}
.ctm-badge[data-tone=cooling]{color:var(--dsw-alias-state-warn-primary);border-color:currentColor;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent)}
.ctm-act-recent{margin-top:4px}
.ctm-act-recent>summary{font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer;list-style:none}
.ctm-act-recent>summary::-webkit-details-marker{display:none}
.ctm-act-list{display:flex;flex-direction:column;gap:3px;margin-top:4px;padding:4px;background:var(--dsw-alias-bg-layer-1);border-radius:6px;font-size:10px}
.ctm-act-row{display:flex;justify-content:space-between;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary)}
.ctm-act-row span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctm-art-shelf{display:flex;flex-direction:column;gap:12px}
.ctm-art-filter{display:flex;align-items:center;gap:8px}
.ctm-art-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px}
.ctm-art-card{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.ctm-art-head{display:flex;justify-content:space-between;align-items:center;gap:6px}
.ctm-art-path{font-family:var(--dsw-font-markdown-code-font-family,monospace);font-size:11px;word-break:break-all;color:var(--dsw-alias-label-primary)}
.ctm-art-changes{display:flex;flex-direction:column;gap:6px;margin-top:10px;padding-top:10px;border-top:.5px solid var(--dsw-alias-border-l2)}
.ctm-chg-item{border:.5px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);padding:6px 8px}
.ctm-chg-item>summary{cursor:pointer;font-size:12px;font-weight:500;color:var(--dsw-alias-label-primary)}
.ctm-chg-diff{margin-top:6px;padding:6px;background:var(--dsw-alias-bg-layer-2);border-radius:4px;overflow-x:auto;font-family:var(--dsw-font-markdown-code-font-family,monospace);font-size:11px}
.ctm-rpt-shelf{display:flex;flex-direction:column;gap:12px}
.ctm-rpt-section{display:flex;flex-direction:column;gap:8px}
.ctm-rpt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px}
.ctm-rpt-box{display:flex;flex-direction:column;gap:4px;padding:10px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.ctm-rpt-box strong{font-size:16px;color:var(--dsw-alias-label-primary)}
.ctm-rpt-defs{margin-top:8px}
.ctm-rpt-defs>summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}
.ctm-rpt-defs-list{display:flex;flex-direction:column;gap:6px;margin-top:6px;padding:8px;background:var(--dsw-alias-bg-layer-1);border-radius:6px;font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.ctm-collapse-wrap{display:contents}
.ctm-list-toggle{align-self:flex-start;margin-top:4px;font-size:11px;padding:2px 8px;border-radius:4px}
.ctm-teammate-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;margin-bottom:12px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l1);border-radius:8px}
.ctm-tm-info{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
.ctm-tm-avatar{width:32px;height:32px;border-radius:50%;background:var(--ctm-accent);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:600;font-size:14px;flex:none}
.ctm-tm-meta{display:flex;flex-direction:column;gap:2px;min-width:0}
.ctm-tm-names{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ctm-tm-sub{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap}
.ctm-tm-actions{display:flex;align-items:center;gap:8px;flex:none}
.ctm-rv-empty{margin:4px 0 8px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.ctm-rv-tasks{display:flex;flex-direction:column;gap:6px}
.ctm-rv-task{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;font-size:12px}
.ctm-rv-task-title{display:flex;align-items:center;gap:6px;min-width:0;color:var(--dsw-alias-label-primary)}
@media (prefers-reduced-motion:reduce){.ctm-switch,.ctm-switch::after,.ctm-ov-group>summary::before,.ctm-bd-open-btn{transition:none!important}}
`;
