import { client } from "snack:client";
import {
  CLASS_UPGRADE_OPTIONS,
  MAX_STAT_LEVEL,
  MOTHERSHIP_LOCK_ON_MS,
  MOTHERSHIP_PLAYER_TARGET_RANGE,
  MOTHERSHIP_TURRET_MOUNTS,
  RAM_IMPACT_PROFILES,
  ROOKIE_PROTECTED_MAX_TIER,
  ROOKIE_SECTOR_MARGIN,
  SHIP_CLASS_INFO,
  SHIP_PHYSICS,
  SHIP_WEAPONS,
  STAT_BONUSES,
  TEAM_COLORS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  classResearchRequirement,
  classUpgradeCost,
  miningMagnetRadius,
  previousShipClass,
  shipTransformTier,
  statCost,
  type ActionMessage,
  type AsteroidKind,
  type AsteroidView,
  type EventMessage,
  type EffectMessage,
  type MothershipView,
  type ProjectileView,
  type SalvageView,
  type ShipClass,
  type ShipView,
  type SnapshotMessage,
  type Team,
} from "./shared/messages.js";
import {
  PacketKind,
  PROTOCOL_VERSION,
  decodeEffect,
  decodeEvent,
  decodeIdentities,
  decodeSalvageSnapshot,
  decodeSnapshot,
  encodeAction,
  encodeInput,
  packetKind,
  runProtocolSelfTest,
} from "./shared/protocol.js";

const root = required<HTMLDivElement>("#app");
const ROOKIE_SECTOR_HINT_MS = 5_000;
const UPGRADE_READY_TIP_MS = 5_000;

root.innerHTML = `
  <canvas id="game" aria-label="Star Trace game field"></canvas>
  <div id="hud">
    <div id="brand">STAR TRACE <span>VECTOR EXTRACTION</span></div>
    <div id="connection">CONNECTING TO MOTHERSHIP</div>
    <button id="sound-toggle" type="button">SOUND · ARMED</button>
    <div id="base-status">
      <div class="base cyan"><b>CYAN CORE</b><div id="cyan-meter" class="meter" role="progressbar" aria-label="Cyan mothership health" aria-valuemin="0" aria-valuemax="100"><i id="cyan-health"></i></div><em id="cyan-value">—%</em></div>
      <div class="base magenta"><b>MAGENTA CORE</b><div id="magenta-meter" class="meter" role="progressbar" aria-label="Magenta mothership health" aria-valuemin="0" aria-valuemax="100"><i id="magenta-health"></i></div><em id="magenta-value">—%</em></div>
    </div>
    <section id="pilot-panel">
      <strong id="pilot-class">SCOUT</strong>
      <small id="pilot-ability"></small>
      <div><span>INTEGRITY</span><b id="pilot-health">—</b></div>
      <div><span>CARGO</span><b id="pilot-cargo">0</b></div>
      <div><span>BANK</span><b id="pilot-bank">0</b></div>
      <div><span>RESEARCH</span><b id="pilot-research">0</b></div>
      <div class="team-reserve"><span>TEAM RESERVE</span><b id="team-bank">0</b></div>
    </section>
    <div id="toast"></div>
    <div id="deep-space-warning" role="status" aria-live="polite" aria-hidden="true" hidden>
      <b>DEEP SPACE</b><span>RETURN TO THE COMBAT ZONE</span>
    </div>
    <div id="mothership-range-warning" role="status" aria-live="polite" aria-hidden="true" hidden>
      <b>ENEMY MOTHERSHIP RANGE</b><span id="mothership-range-copy">DEFENSE CANNONS TRACKING</span>
    </div>
    <div id="rookie-sector-warning" role="status" aria-live="polite" aria-hidden="true" hidden>
      <b>ROOKIE SECTOR</b><span>PVP FIRE SUPPRESSED · MINE · BANK · TRANSFORM</span>
    </div>
    <div id="dock-scrim" aria-hidden="true"></div>
    <section id="dock-panel">
      <div class="dock-title">
        <b>MOTHERSHIP LINK</b>
        <span>FRAME <i id="transform-tier">0</i> / 4 · RESEARCH UNLOCKS FRAMES</span>
        <button id="dock-collapse" type="button" aria-controls="dock-content" aria-expanded="false">UPGRADES</button>
      </div>
      <div id="dock-content">
        <div id="dock-feedback" role="status" aria-live="polite"></div>
        <div id="transform-row" class="upgrade-row class-row"></div>
        <div class="upgrade-row stat-row">
          <button data-action="upgradeStat" data-value="weapon"><b>WEAPON</b><span data-level="weapon">${"○".repeat(MAX_STAT_LEVEL)}</span><em data-cost="weapon">${statCost(0)}</em></button>
          <button data-action="upgradeStat" data-value="engine"><b>ENGINE</b><span data-level="engine">${"○".repeat(MAX_STAT_LEVEL)}</span><em data-cost="engine">${statCost(0)}</em></button>
          <button data-action="upgradeStat" data-value="hull"><b>HULL</b><span data-level="hull">${"○".repeat(MAX_STAT_LEVEL)}</span><em data-cost="hull">${statCost(0)}</em></button>
          <button data-action="upgradeStat" data-value="mining" title="INCREASES ASTEROID DAMAGE AND ATTRACTS NEARBY SALVAGE"><b>MINING</b><span data-level="mining">${"○".repeat(MAX_STAT_LEVEL)}</span><em data-cost="mining">${statCost(0)}</em></button>
        </div>
        <div class="repair-row">
          <button data-action="repair"><b>REPAIR SHIP</b><span>RESTORE 32 INTEGRITY</span></button>
          <button data-action="repairMothership"><b>REPAIR MOTHERSHIP</b><span>15 TEAM RESERVE</span></button>
        </div>
      </div>
    </section>
    <div id="touch-guide" aria-hidden="true">
      <span class="move"><b>MOVE</b><i>DRAG</i></span>
      <span class="aim"><b>AIM + FIRE</b><i>DRAG</i></span>
    </div>
    <div id="prompt">WASD MOVE · MOUSE AIM/FIRE · FLY INSIDE YOUR MOTHERSHIP TO UPGRADE</div>
    <div id="respawn-overlay" role="status" aria-label="Respawn timer" aria-live="polite" aria-hidden="true" hidden>
      <span>SHIP LOST</span><b id="respawn-countdown">4.0</b><em>RECONSTRUCTING AT MOTHERSHIP</em>
    </div>
    <div id="winner"><b></b><span></span></div>
    <output id="playtest-state" aria-label="Playtest state"></output>
    <output id="performance-state" aria-label="Performance state"></output>
  </div>
`;

const style = document.createElement("style");
style.textContent = `
  :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  * { box-sizing: border-box; }
  html, body, #app { width: 100%; height: 100%; min-height: 100dvh; margin: 0; overflow: hidden; background: #010207; }
  body { color: #e9fffc; user-select: none; overscroll-behavior: none; -webkit-user-select: none; -webkit-touch-callout: none; }
  #game { display: block; position: absolute; z-index: 0; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
  #app::after { content: ""; position: absolute; z-index: 1; inset: 0; pointer-events: none; background: radial-gradient(circle at 50% 48%, transparent 48%, #01020755 100%), repeating-linear-gradient(0deg, #0000 0 3px, #aaffff09 3px 4px); }
  #hud { position: fixed; z-index: 2; inset: 0; pointer-events: none; text-transform: uppercase; letter-spacing: .08em; }
  #brand { position: absolute; top: calc(20px + env(safe-area-inset-top, 0px)); left: max(52px, calc(12px + env(safe-area-inset-left, 0px))); font-size: 18px; font-weight: 800; color: #fff; text-shadow: 0 0 12px #63fff3; }
  #brand span { display: block; margin-top: 4px; font-size: 10px; font-weight: 600; color: #63fff3; letter-spacing: .18em; }
  #connection { position: absolute; top: calc(23px + env(safe-area-inset-top, 0px)); right: max(22px, calc(12px + env(safe-area-inset-right, 0px))); font-size: 11px; color: #b1c3d5; }
  #sound-toggle { pointer-events: auto; position: absolute; right: max(22px, calc(12px + env(safe-area-inset-right, 0px))); top: calc(50px + env(safe-area-inset-top, 0px)); min-height: 0; width: auto; padding: 7px 10px; color: #a9bdcc; border: 1px solid #345069; background: #030812e8; font-size: 9px; letter-spacing: .08em; }
  #base-status { position: absolute; top: calc(18px + env(safe-area-inset-top, 0px)); left: 50%; width: min(620px, 46vw); transform: translateX(-50%); display: flex; gap: 22px; }
  .base { flex: 1; display: grid; grid-template-columns: 1fr auto; gap: 6px 10px; font-size: 10px; }
  .base b { color: #fff; }
  .base em { grid-column: 2; grid-row: 1 / span 2; align-self: center; font-size: 13px; font-style: normal; }
  .meter { height: 5px; background: #172032; overflow: hidden; }
  .meter i { display: block; width: 100%; height: 100%; transition: width .18s linear; box-shadow: 0 0 9px currentColor; }
  .cyan { color: #63fff3; } .cyan .meter i { background: #63fff3; }
  .magenta { color: #ff5eaa; } .magenta .meter i { background: #ff5eaa; }
  #pilot-panel { position: absolute; left: max(22px, calc(12px + env(safe-area-inset-left, 0px))); top: calc(82px + env(safe-area-inset-top, 0px)); width: 210px; padding: 13px 14px; border-left: 1px solid #63fff3; background: linear-gradient(90deg, #09121bed, transparent); font-size: 11px; }
  #pilot-panel strong { display: block; margin-bottom: 10px; color: #63fff3; font-size: 16px; text-shadow: 0 0 8px currentColor; }
  #pilot-ability { display: none; margin: -5px 0 9px; color: #fff; font-size: 8px; line-height: 1.4; text-shadow: 0 0 8px currentColor; }
  #pilot-ability.visible { display: block; }
  #pilot-panel div { display: flex; justify-content: space-between; padding: 4px 0; color: #a9bdcc; }
  #pilot-panel b { color: #fff; }
  body:not(.is-docked) #pilot-panel { display: flex; align-items: center; gap: 13px; width: auto; max-width: calc(100vw - 24px); padding: 7px 10px; border-left: 0; border-bottom: 1px solid #63fff366; background: #020914c7; box-shadow: 0 0 16px #63fff30d; font-size: 8px; opacity: .82; }
  body:not(.is-docked) #pilot-panel strong,
  body:not(.is-docked) #pilot-ability,
  body:not(.is-docked) #pilot-panel .team-reserve { display: none; }
  body:not(.is-docked) #pilot-panel div { display: grid; min-width: 4ch; gap: 2px; padding: 0; }
  body:not(.is-docked) #pilot-panel div span { font-size: 7px; letter-spacing: .1em; }
  body:not(.is-docked) #pilot-panel div b { font-size: 10px; font-variant-numeric: tabular-nums; }
  #toast { position: absolute; top: 126px; left: 50%; min-width: min(300px, calc(100vw - 24px)); padding: 10px 18px; transform: translate(-50%, -8px); opacity: 0; text-align: center; font-size: 12px; background: #061017ed; border: 1px solid #63fff3; color: #63fff3; transition: opacity .16s, transform .16s, top .16s; }
  #toast.show { opacity: 1; transform: translate(-50%, 0); }
  #toast.bad { border-color: #ff5eaa; color: #ff5eaa; }
  #toast.good { border-color: #ecff45; color: #ecff45; }
  body.has-center-warning:not(.is-docked) #pilot-panel { top: calc(116px + env(safe-area-inset-top, 0px)); }
  body.has-center-warning #toast { top: calc(160px + env(safe-area-inset-top, 0px)); }
  #deep-space-warning { position: absolute; top: 62px; left: 50%; min-width: 280px; padding: 8px 18px; transform: translate(-50%, -8px); opacity: 0; text-align: center; border: 1px solid #efff4d; background: #080b03e6; box-shadow: 0 0 22px #efff4d22, inset 0 0 16px #efff4d0d; color: #efff4d; transition: opacity .18s, transform .18s; }
  #deep-space-warning.visible { opacity: 1; transform: translate(-50%, 0); }
  #deep-space-warning b { display: block; font-size: 14px; text-shadow: 0 0 9px currentColor; }
  #deep-space-warning span { display: block; margin-top: 4px; color: #dce6a3; font-size: 9px; letter-spacing: .12em; }
  #mothership-range-warning { position: absolute; top: 62px; left: 50%; min-width: 330px; padding: 8px 18px; transform: translate(-50%, -8px); opacity: 0; text-align: center; border: 1px solid #ff5eaa; background: #10030bed; box-shadow: 0 0 22px #ff5eaa2b, inset 0 0 16px #ff5eaa12; color: #ff5eaa; transition: opacity .18s, transform .18s; }
  #mothership-range-warning.visible { opacity: 1; transform: translate(-50%, 0); }
  #mothership-range-warning.locked { border-color: #fff; box-shadow: 0 0 30px #ff5eaa55, inset 0 0 22px #ff5eaa1f; }
  #mothership-range-warning b { display: block; font-size: 14px; text-shadow: 0 0 9px currentColor; }
  #mothership-range-warning span { display: block; margin-top: 4px; color: #ffc0da; font-size: 9px; letter-spacing: .12em; }
  #rookie-sector-warning { position: absolute; top: 62px; left: 50%; min-width: 360px; padding: 8px 18px; transform: translate(-50%, -8px); opacity: 0; text-align: center; border: 1px solid currentColor; background: #030b12ed; box-shadow: 0 0 22px currentColor; color: #63fff3; transition: opacity .18s, transform .18s; }
  #rookie-sector-warning.visible { opacity: 1; transform: translate(-50%, 0); }
  #rookie-sector-warning b { display: block; font-size: 14px; text-shadow: 0 0 9px currentColor; }
  #rookie-sector-warning span { display: block; margin-top: 4px; color: #d9e9f2; font-size: 9px; letter-spacing: .12em; }
  #dock-scrim { display: none; position: absolute; inset: 0; pointer-events: auto; touch-action: none; }
  body.is-docked.dock-menu-expanded.dock-menu-collapsible #dock-scrim { display: block; }
  #dock-panel { pointer-events: auto; position: absolute; left: auto; right: max(18px, calc(10px + env(safe-area-inset-right, 0px))); top: calc(76px + env(safe-area-inset-top, 0px)); width: min(540px, calc(100vw - 36px)); max-height: calc(100dvh - 94px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)); overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; padding: 16px; border: 1px solid #63fff3; background: #020711f2; box-shadow: 0 0 28px #16fff020, inset 0 0 22px #16fff00d; opacity: 0; transform: translateX(20px); transition: opacity .18s, transform .18s; pointer-events: none; }
  #dock-panel.visible { opacity: 1; transform: translateX(0); pointer-events: auto; }
  #dock-panel.collapsed { top: auto; bottom: max(18px, calc(10px + env(safe-area-inset-bottom, 0px))); left: auto; right: max(18px, calc(10px + env(safe-area-inset-right, 0px))); width: auto; max-height: none; overflow: hidden; padding: 0; border-color: transparent; background: transparent; box-shadow: none; transform: translateX(20px); }
  #dock-panel.collapsed.visible { transform: translateX(0); }
  #dock-panel.collapsed .dock-title { margin: 0; }
  #dock-panel.collapsed .dock-title > b,
  #dock-panel.collapsed .dock-title > span,
  #dock-panel.collapsed #dock-content { display: none; }
  #dock-panel.collapsed #dock-collapse { border-color: #63fff3; background: #03121de8; box-shadow: 0 0 20px #63fff32b, inset 0 0 14px #63fff312; }
  body.dock-menu-mobile.is-docked.dock-menu-expanded #brand,
  body.dock-menu-mobile.is-docked.dock-menu-expanded #connection,
  body.dock-menu-mobile.is-docked.dock-menu-expanded #sound-toggle,
  body.dock-menu-mobile.is-docked.dock-menu-expanded #base-status,
  body.dock-menu-mobile.is-docked.dock-menu-expanded #pilot-panel,
  body.dock-menu-mobile.is-docked.dock-menu-expanded #deep-space-warning,
  body.dock-menu-mobile.is-docked.dock-menu-expanded #mothership-range-warning,
  body.dock-menu-mobile.is-docked.dock-menu-expanded #rookie-sector-warning,
  body.dock-menu-mobile.is-docked.dock-menu-expanded #touch-guide,
  body.dock-menu-mobile.is-docked.dock-menu-expanded #prompt { visibility: hidden; pointer-events: none; }
  .dock-title { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin-bottom: 13px; color: #63fff3; }
  .dock-title b { flex: none; font-size: 16px; text-shadow: 0 0 10px currentColor; }
  .dock-title span { font-size: 9px; line-height: 1.4; color: #a9bdcc; text-align: right; }
  #dock-collapse { display: block; min-width: 112px; min-height: 44px; padding: 9px 12px; border-color: #63fff3; color: #63fff3; text-align: center; font-size: 10px; font-weight: 800; letter-spacing: .12em; }
  #dock-feedback { display: none; margin-bottom: 8px; padding: 9px 12px; border: 1px solid #63fff3; background: #061017ed; color: #63fff3; text-align: center; font-size: 10px; }
  #dock-feedback.show { display: block; }
  #dock-feedback.bad { border-color: #ff5eaa; color: #ff5eaa; }
  #dock-feedback.good { border-color: #ecff45; color: #ecff45; }
  .upgrade-row, .repair-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 8px; }
  #transform-row { border-top: 1px solid #263849; padding-top: 8px; }
  #transform-row.two-options { grid-template-columns: repeat(2, 1fr); }
  #transform-row.one-option { grid-template-columns: 1fr; }
  .repair-row { grid-template-columns: 1fr 1fr; }
  button { min-height: 66px; padding: 10px 9px; color: #dff; border: 1px solid #34566b; background: #07111c; font: inherit; text-align: left; letter-spacing: .05em; cursor: pointer; transition: border-color .12s, background .12s, color .12s; }
  button:hover:not(:disabled) { border-color: #63fff3; background: #0a1b27; color: #63fff3; }
  button:disabled { opacity: .48; cursor: not-allowed; }
  button.current { border-color: #ecff45; color: #ecff45; }
  button b, button span, button em { display: block; }
  button b { font-size: 11px; }
  button span { margin-top: 5px; color: #a9bdcc; font-size: 9px; line-height: 1.4; }
  button em { margin-top: 6px; color: #ecff45; font-size: 10px; font-style: normal; }
  .stat-row button span { color: #63fff3; letter-spacing: .12em; }
  .launch { border-color: #63fff3; }
  #touch-guide { display: none; position: absolute; inset: 0; pointer-events: none; }
  #touch-guide span { position: absolute; bottom: max(132px, calc(24% + env(safe-area-inset-bottom, 0px))); min-width: 112px; padding: 10px 13px; border: 1px solid currentColor; background: #030914d9; text-align: center; box-shadow: 0 0 18px #63fff31c; animation: touch-guide-pulse 1.8s ease-in-out infinite; }
  #touch-guide .move { left: max(18px, calc(12px + env(safe-area-inset-left, 0px))); color: #63fff3; }
  #touch-guide .aim { right: max(18px, calc(12px + env(safe-area-inset-right, 0px))); color: #ff5eaa; animation-delay: -.9s; }
  #touch-guide b, #touch-guide i { display: block; }
  #touch-guide b { font-size: 11px; letter-spacing: .14em; }
  #touch-guide i { margin-top: 4px; color: #b7c8d8; font-size: 8px; font-style: normal; }
  body.touch-controls #touch-guide { display: block; }
  body.touch-controls.touch-move-learned #touch-guide .move,
  body.touch-controls.touch-aim-learned #touch-guide .aim,
  body.touch-controls.is-docked #touch-guide,
  body.touch-controls.is-respawning #touch-guide { display: none; }
  #prompt { position: absolute; bottom: calc(17px + env(safe-area-inset-bottom, 0px)); left: 50%; transform: translateX(-50%); color: #9cafc0; font-size: 10px; white-space: nowrap; }
  body.is-docked #prompt { display: none; }
  #respawn-overlay { position: absolute; inset: 0; display: grid; place-content: center; gap: 6px; text-align: center; opacity: 0; background: radial-gradient(circle at center, #020812b8 0, #0102075c 31%, transparent 58%); transition: opacity .14s; }
  #respawn-overlay[hidden] { display: none; }
  #respawn-overlay.visible { opacity: 1; }
  #respawn-overlay span { font-size: 14px; color: #fff; letter-spacing: .26em; text-shadow: 0 0 12px currentColor; }
  #respawn-overlay b { min-width: 3ch; font-size: clamp(58px, 9vw, 116px); line-height: .95; font-variant-numeric: tabular-nums; text-shadow: 0 0 28px currentColor; }
  #respawn-overlay em { color: #b7c8d8; font-size: 11px; font-style: normal; letter-spacing: .15em; }
  #winner { position: absolute; inset: 0; display: grid; place-content: center; gap: 12px; text-align: center; background: #010207b8; opacity: 0; transition: opacity .25s; }
  #winner.visible { opacity: 1; }
  #winner b { font-size: clamp(34px, 6vw, 88px); color: #fff; text-shadow: 0 0 25px currentColor; }
  #winner span { font-size: 14px; color: #bdcad8; }
  #playtest-state, #performance-state { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  @keyframes touch-guide-pulse { 0%, 100% { opacity: .72; transform: scale(1); } 50% { opacity: 1; transform: scale(1.035); } }
  @media (max-width: 760px) {
    #brand { top: calc(12px + env(safe-area-inset-top, 0px)); left: max(48px, calc(10px + env(safe-area-inset-left, 0px))); font-size: 15px; }
    #brand span { font-size: 8px; }
    #connection { display: none; }
    #sound-toggle { top: calc(8px + env(safe-area-inset-top, 0px)); right: max(8px, calc(8px + env(safe-area-inset-right, 0px))); min-width: 44px; min-height: 44px; padding: 8px 10px; }
    #base-status { top: calc(62px + env(safe-area-inset-top, 0px)); left: max(10px, calc(8px + env(safe-area-inset-left, 0px))); right: max(10px, calc(8px + env(safe-area-inset-right, 0px))); width: auto; transform: none; gap: 12px; }
    .base { font-size: 10px; } .base em { display: block; min-width: 4ch; font-size: 10px; text-align: right; }
    #pilot-panel { top: calc(104px + env(safe-area-inset-top, 0px)); left: max(10px, calc(8px + env(safe-area-inset-left, 0px))); width: 178px; font-size: 10px; }
    body:not(.is-docked) #pilot-panel { width: auto; max-width: calc(100vw - 20px); }
    body.has-center-warning:not(.is-docked) #pilot-panel { top: calc(104px + env(safe-area-inset-top, 0px)); }
    #pilot-panel strong { font-size: 14px; }
    #toast { top: calc(144px + env(safe-area-inset-top, 0px)); }
    body.has-center-warning #toast { top: calc(202px + env(safe-area-inset-top, 0px)); }
    #deep-space-warning { top: calc(144px + env(safe-area-inset-top, 0px)); min-width: min(260px, calc(100vw - 24px)); padding: 7px 12px; }
    #mothership-range-warning { top: calc(144px + env(safe-area-inset-top, 0px)); min-width: min(330px, calc(100vw - 24px)); padding: 7px 12px; }
    #rookie-sector-warning { top: calc(144px + env(safe-area-inset-top, 0px)); min-width: min(360px, calc(100vw - 24px)); padding: 7px 12px; }
    #dock-panel { top: 50%; bottom: auto; left: 50%; right: auto; max-height: calc(100dvh - 82px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)); transform: translate(-50%, calc(-50% + 20px)); }
    #dock-panel.visible { transform: translate(-50%, -50%); }
    body.touch-controls #dock-panel { width: min(58vw, 420px); }
    .dock-title { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 5px 10px; }
    .dock-title > b { grid-column: 1; grid-row: 1; }
    .dock-title > span { grid-column: 1; grid-row: 2; text-align: left; }
    #dock-collapse { display: block; grid-column: 2; grid-row: 1 / span 2; }
    #dock-panel.collapsed { top: auto; bottom: max(10px, calc(8px + env(safe-area-inset-bottom, 0px))); left: 50%; right: auto; width: auto; max-height: none; overflow: hidden; padding: 0; border-color: transparent; background: transparent; box-shadow: none; transform: translate(-50%, 20px); }
    #dock-panel.collapsed.visible { transform: translate(-50%, 0); }
    #dock-panel.collapsed .dock-title { margin: 0; }
    #dock-panel.collapsed .dock-title > b,
    #dock-panel.collapsed .dock-title > span,
    #dock-panel.collapsed #dock-content { display: none; }
    #dock-panel.collapsed #dock-collapse { border-color: #63fff3; background: #03121de8; box-shadow: 0 0 20px #63fff32b, inset 0 0 14px #63fff312; }
    .upgrade-row { grid-template-columns: repeat(2, 1fr); }
    .repair-row { grid-template-columns: 1fr; }
    #prompt { bottom: calc(10px + env(safe-area-inset-bottom, 0px)); width: calc(100vw - 20px); font-size: 10px; line-height: 1.4; text-align: center; white-space: normal; }
    body.touch-controls #prompt { display: none; }
  }
  @media (max-width: 520px) {
    #dock-panel { max-height: calc(100dvh - 152px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)); }
    .dock-title { display: flex; align-items: stretch; flex-direction: column; gap: 6px; }
    .dock-title span { text-align: left; }
    #dock-collapse { width: 100%; min-width: 0; }
    body.touch-controls #dock-panel { left: 50%; right: auto; width: min(420px, calc(100vw - 16px)); padding: 12px; }
    body.touch-controls #dock-panel.collapsed { left: 50%; right: auto; width: auto; padding: 0; }
    body.touch-controls #dock-panel .upgrade-row,
    body.touch-controls #dock-panel .repair-row { grid-template-columns: 1fr; }
    body.touch-controls #pilot-panel { width: 164px; padding: 10px 11px; }
    body.touch-controls:not(.is-docked) #pilot-panel { width: auto; max-width: calc(100vw - 20px); padding: 7px 10px; }
  }
  @media (max-height: 560px) and (orientation: landscape) {
    #pilot-panel { top: calc(64px + env(safe-area-inset-top, 0px)); }
    body.has-center-warning:not(.is-docked) #pilot-panel { top: calc(164px + env(safe-area-inset-top, 0px)); }
    body.has-center-warning #toast { top: calc(118px + env(safe-area-inset-top, 0px)); }
    #base-status { top: calc(12px + env(safe-area-inset-top, 0px)); width: min(520px, 50vw); left: 50%; right: auto; transform: translateX(-50%); }
    #dock-panel { top: 50%; bottom: auto; left: 50%; right: auto; max-height: calc(100dvh - 16px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)); transform: translate(-50%, calc(-50% + 20px)); }
    #dock-panel.visible { transform: translate(-50%, -50%); }
    #dock-collapse { display: block; flex: none; }
    #dock-panel.collapsed { top: auto; bottom: max(8px, calc(8px + env(safe-area-inset-bottom, 0px))); left: 50%; right: auto; width: auto; max-height: none; overflow: hidden; padding: 0; border-color: transparent; background: transparent; box-shadow: none; transform: translate(-50%, 20px); }
    #dock-panel.collapsed.visible { transform: translate(-50%, 0); }
    #dock-panel.collapsed .dock-title { margin: 0; }
    #dock-panel.collapsed .dock-title > b,
    #dock-panel.collapsed .dock-title > span,
    #dock-panel.collapsed #dock-content { display: none; }
    #dock-panel.collapsed #dock-collapse { border-color: #63fff3; background: #03121de8; box-shadow: 0 0 20px #63fff32b, inset 0 0 14px #63fff312; }
    body.touch-controls #prompt { display: none; }
    #touch-guide span { bottom: max(72px, calc(18% + env(safe-area-inset-bottom, 0px))); }
  }
  @media (prefers-reduced-motion: reduce) {
    #toast, #deep-space-warning, #mothership-range-warning, #rookie-sector-warning, #dock-panel, #respawn-overlay, #winner, .meter i { transition: none; }
    #touch-guide span { animation: none; }
  }
`;
document.head.append(style);

const canvas = required<HTMLCanvasElement>("#game");
const context = requiredContext(canvas);
let inputSurface: HTMLCanvasElement = canvas;

const connectionLabel = required<HTMLElement>("#connection");
const dockScrim = required<HTMLElement>("#dock-scrim");
const dockPanel = required<HTMLElement>("#dock-panel");
const dockContent = required<HTMLElement>("#dock-content");
const dockFeedback = required<HTMLElement>("#dock-feedback");
const dockCollapse = required<HTMLButtonElement>("#dock-collapse");
const transformRow = required<HTMLElement>("#transform-row");
const toast = required<HTMLElement>("#toast");
const deepSpaceWarning = required<HTMLElement>("#deep-space-warning");
const mothershipRangeWarning = required<HTMLElement>("#mothership-range-warning");
const mothershipRangeCopy = required<HTMLElement>("#mothership-range-copy");
const rookieSectorWarning = required<HTMLElement>("#rookie-sector-warning");
const respawnOverlay = required<HTMLElement>("#respawn-overlay");
const respawnCountdown = required<HTMLElement>("#respawn-countdown");
const winnerPanel = required<HTMLElement>("#winner");
const soundToggle = required<HTMLButtonElement>("#sound-toggle");
const keys = new Set<string>();
const displayShips = new Map<string, { x: number; y: number; angle: number }>();
const particles: Particle[] = [];
const flashes: Flash[] = [];
const knownProjectiles = new Set<number>();
let projectilesInitialized = false;
const seenEffectIds = new Set<number>();
const effectIdOrder: number[] = [];
const playerNames = new Map<number, string>();
const asteroidPaths = new Map<
  number,
  { seed: number; radius: number; kind: AsteroidKind; path: Path2D }
>();
const shipPaths = new Map<ShipClass, Path2D>();
const mothershipPaths = new Map<Team, Path2D>();
const salvageDisplays = new Map<number, SalvageDisplay>();
const MAX_EFFECT_PARTICLES = 240;
const MAX_EFFECT_FLASHES = 24;
const PREDICTION_STEP_SECONDS = 1 / 60;
const MAX_PREDICTION_CATCH_UP_STEPS = 4;
const LOCAL_TURN_RESPONSE = 24;
const REMOTE_POSITION_RESPONSE = 22;
const REMOTE_TURN_RESPONSE = 18;
const DEEP_SPACE_MARGIN = 850;
const CAMERA_SCALE_BY_TIER = [1, 0.89, 0.81, 0.75, 0.71] as const;
const CAMERA_ZOOM_RESPONSE = 3.5;
const VECTOR_GRID_SPACING = 320;
const VECTOR_GRID_MAJOR_INTERVAL = 4;
const NAVIGATION_LANE_Y = [WORLD_HEIGHT * 0.25, WORLD_HEIGHT * 0.5, WORLD_HEIGHT * 0.75] as const;
const TOUCH_MOVE_SIDE_FRACTION = 0.45;
const TOUCH_STICK_RADIUS = 58;
const TOUCH_STICK_DEAD_ZONE = 0.16;
const TOUCH_GUIDE_TIMEOUT_MS = 12_000;
const SALVAGE_POSITION_RESPONSE = 20;
const SALVAGE_MAX_EXTRAPOLATION_SECONDS = 0.12;
const SHIP_BLOOM_SCALE = 1.22;
const ASTEROID_STYLES: Record<
  AsteroidKind,
  { color: string; vertices: number; jitter: number; dotScale: number }
> = {
  rock: { color: "#dfff43", vertices: 9, jitter: 0.26, dotScale: 1 },
  iron: { color: "#ff9f43", vertices: 8, jitter: 0.18, dotScale: 1.1 },
  crystal: { color: "#63fff3", vertices: 6, jitter: 0.34, dotScale: 0.85 },
  core: { color: "#bf7cff", vertices: 10, jitter: 0.12, dotScale: 1.6 },
};

let snapshot: SnapshotMessage | undefined;
let renderedTransformClass: ShipClass | undefined;
let snapshotReceivedAt = 0;
let cameraX = WORLD_WIDTH / 2;
let cameraY = WORLD_HEIGHT / 2;
let cameraInitialized = false;
let connected = false;
let sequence = 0;
let lastSnapshotSequence = -1;
let lastSnapshotBytes = 0;
let visibleSalvage: SalvageView[] = [];
let lastSalvageSequence = -1;
let lastSalvageBytes = 0;
let aimScreenX = window.innerWidth / 2;
let aimScreenY = window.innerHeight / 2;
let pointerFire = false;
let toastTimer = 0;
let renderScale = 1;
let cameraTierScale = 1;
let lastFrameAt = performance.now();
let predictionAccumulator = 0;
let predictedSelf: PredictedSelf | undefined;
let currentInput = { moveX: 0, moveY: 0, fire: false };
let shakeStrength = 0;
let shakeX = 0;
let shakeY = 0;
let nextLocalFireAt = 0;
let predictedDashUntil = 0;
let audioContext: AudioContext | undefined;
let impactNoise: AudioBuffer | undefined;
let soundEnabled = true;
let lastPickupSoundAt = -Infinity;
const turretAngles = new Map<string, number>();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const mobileDockMedia = window.matchMedia(
  "(max-width: 760px), (max-height: 560px) and (orientation: landscape)",
);
const touchControlsEnabled = isTouchDevice();
let dockPanelCollapsed = mobileDockMedia.matches;
let inputSendInFlight = false;
let queuedInput: Uint8Array | undefined;
let actionSendInFlight = false;
const actionQueue: Uint8Array[] = [];
const frameSamples = new Float32Array(240);
const renderSamples = new Float32Array(240);
let performanceSampleIndex = 0;
let performanceSampleCount = 0;
let nextPerformanceReportAt = 0;
let maxWorkSinceReport = 0;
let maxParticlesSinceReport = 0;
let maxEffectDrawCallsSinceReport = 0;
let frameGlowCalls = 0;
let maxGlowCallsSinceReport = 0;
let frameVisibleEntities = 0;
let maxVisibleEntitiesSinceReport = 0;
let maxPredictionStepsSinceReport = 0;
let mothershipThreatStartedAt = 0;
let rookieSectorHintUntil = 0;
let rookieSectorHintShown = false;
let upgradeReadyTipShipId = "";
let upgradeReadyTipShown = false;
let localShipWasAlive = true;
let touchMove: TouchStick | undefined;
let touchAim: TouchStick | undefined;
let touchGuideTimer = 0;
let touchMouseEmulation = false;

interface PredictedSelf {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
}

interface TouchStick {
  id: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface SalvageDisplay {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
  targetAt: number;
  sequence: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  rotation: number;
  spin: number;
  color: string;
  fragment: boolean;
}

interface Flash {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  radius: number;
  color: string;
  dotScale?: number;
}

interface EffectBatch {
  path: Path2D;
  color: string;
  alpha: number;
  width: number;
}

resize();
if (import.meta.env.DEV) {
  runProtocolSelfTest();
  runDeepSpaceSelfTest();
  runMothershipThreatSelfTest();
  runRookieSectorSelfTest();
  runUpgradeReadinessSelfTest();
  runMothershipUpgradeBaySelfTest();
  runProgressionSelfTest();
  runBaseBreakEffectSelfTest();
}
window.addEventListener("resize", resize);
window.visualViewport?.addEventListener("resize", resize);
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
window.addEventListener("blur", () => {
  resetInputState();
  sendInput();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    resetInputState();
    sendInput();
  }
  predictionAccumulator = 0;
  lastFrameAt = performance.now();
});
bindInputSurface(canvas);
setupTouchControls();
applyDockPanelState();
mobileDockMedia.addEventListener("change", (event) => {
  dockPanelCollapsed = event.matches;
  applyDockPanelState();
});
soundToggle.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundToggle.textContent = soundEnabled ? "SOUND · ON" : "SOUND · OFF";
  if (soundEnabled) {
    unlockAudio();
  } else {
    void audioContext?.suspend();
  }
});

dockCollapse.addEventListener("click", () => {
  dockPanelCollapsed = !dockPanelCollapsed;
  applyDockPanelState();
});

dockScrim.addEventListener("pointerdown", (event) => {
  event.preventDefault();
});
dockScrim.addEventListener("click", () => {
  if (dockPanelCollapsed) return;
  dockPanelCollapsed = true;
  applyDockPanelState();
  dockCollapse.focus({ preventScroll: true });
});

dockPanel.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action as ActionMessage["action"];
  sendAction(action, button.dataset.value);
});

void client.ready
  .then(() => {
    connected = true;
    connectionLabel.textContent = "MOTHERSHIP LINK STABLE";
    connectionLabel.style.color = "#63fff3";
    window.setInterval(sendInput, 1000 / 60);
  })
  .catch(() => {
    connectionLabel.textContent = "LINK FAILED";
    connectionLabel.style.color = "#ff5eaa";
  });

void readDatagrams();
void readStreams();
void client.closed.then(() => {
  connected = false;
  connectionLabel.textContent = "LINK CLOSED";
  connectionLabel.style.color = "#ff5eaa";
});

requestAnimationFrame(render);

async function readDatagrams(): Promise<void> {
  try {
    while (true) {
      const event = await client.datagrams.recv();
      const kind = packetKind(event.bytes);
      if (kind === PacketKind.Snapshot) {
        const message = decodeSnapshot(event.bytes, playerNames);
        if (message && message.sequence > lastSnapshotSequence) {
          lastSnapshotSequence = message.sequence;
          lastSnapshotBytes = event.bytes.byteLength;
          applySnapshot(message);
        }
      } else if (kind === PacketKind.Salvage) {
        const message = decodeSalvageSnapshot(event.bytes);
        if (message && message.sequence > lastSalvageSequence) {
          lastSalvageSequence = message.sequence;
          lastSalvageBytes = event.bytes.byteLength;
          applySalvageSnapshot(message.salvage, message.sequence);
        }
      } else if (kind === PacketKind.Effect) {
        const message = decodeEffect(event.bytes);
        if (message) spawnImpact(message);
      }
    }
  } catch {
    await client.closed;
  }
}

function applySalvageSnapshot(items: SalvageView[], salvageSequence: number): void {
  const sampleAt = performance.now();
  visibleSalvage = items;
  for (const item of items) {
    const display = salvageDisplays.get(item.id);
    if (!display) {
      salvageDisplays.set(item.id, {
        x: item.x,
        y: item.y,
        targetX: item.x,
        targetY: item.y,
        vx: 0,
        vy: 0,
        targetAt: sampleAt,
        sequence: salvageSequence,
      });
      continue;
    }
    const elapsed = Math.max(0.016, (sampleAt - display.targetAt) / 1000);
    display.vx = (item.x - display.targetX) / elapsed;
    display.vy = (item.y - display.targetY) / elapsed;
    display.targetX = item.x;
    display.targetY = item.y;
    display.targetAt = sampleAt;
    display.sequence = salvageSequence;
  }
  for (const [id, display] of salvageDisplays) {
    if (display.sequence !== salvageSequence) salvageDisplays.delete(id);
  }
}

async function readStreams(): Promise<void> {
  try {
    while (true) {
      const event = await client.streams.recv();
      const kind = packetKind(event.bytes);
      if (kind === PacketKind.Event) {
        const message = decodeEvent(event.bytes);
        if (message) showToast(message);
      } else if (kind === PacketKind.Identity) {
        const batch = decodeIdentities(event.bytes);
        if (!batch) continue;
        if (batch.replace) playerNames.clear();
        for (const identity of batch.identities) playerNames.set(identity.id, identity.name);
      } else if (kind === PacketKind.Effect) {
        const message = decodeEffect(event.bytes);
        if (message) spawnImpact(message);
      }
    }
  } catch {
    await client.closed;
  }
}

function applySnapshot(message: SnapshotMessage): void {
  snapshot = message;
  snapshotReceivedAt = performance.now();
  const self = message.ships.find((ship) => ship.id === message.selfId);
  if (self) reconcilePrediction(self);
  observeProjectiles(message);
  if (!cameraInitialized && self) {
    cameraX = self.x;
    cameraY = self.y;
    cameraInitialized = true;
  }
  updateHud(message);
}

function sendInput(): void {
  if (!connected) {
    return;
  }
  let moveX =
    Number(keys.has("KeyD") || keys.has("ArrowRight")) -
    Number(keys.has("KeyA") || keys.has("ArrowLeft"));
  let moveY =
    Number(keys.has("KeyS") || keys.has("ArrowDown")) -
    Number(keys.has("KeyW") || keys.has("ArrowUp"));
  if (touchMove) {
    const touchVector = touchStickVector(touchMove);
    moveX += touchVector.x;
    moveY += touchVector.y;
  }
  const magnitude = Math.hypot(moveX, moveY);
  if (magnitude > 1) {
    moveX /= magnitude;
    moveY /= magnitude;
  }
  const point = screenToWorld(aimScreenX, aimScreenY);
  const message = {
    type: "input" as const,
    sequence: (sequence = (sequence + 1) >>> 0),
    moveX,
    moveY,
    aimX: point.x,
    aimY: point.y,
    fire: pointerFire || keys.has("Space"),
  };
  currentInput = { moveX, moveY, fire: message.fire };
  if (message.fire) {
    triggerImmediateWeapon(performance.now());
  }
  queueInput(encodeInput(message));
}

function sendAction(action: ActionMessage["action"], value?: string): void {
  if (!connected) {
    return;
  }
  const message = (
    value ? { type: "action", action, value } : { type: "action", action }
  ) as ActionMessage;
  actionQueue.push(encodeAction(message));
  if (actionQueue.length > 8) actionQueue.shift();
  void flushActions();
}

function queueInput(message: Uint8Array): void {
  queuedInput = message;
  if (!inputSendInFlight) void flushInput();
}

async function flushInput(): Promise<void> {
  const message = queuedInput;
  if (!message || inputSendInFlight) return;
  queuedInput = undefined;
  inputSendInFlight = true;
  try {
    await client.datagrams.send(message);
  } catch {
    // Connection lifecycle updates the HUD; stale inputs are safe to discard.
  } finally {
    inputSendInFlight = false;
    if (queuedInput) void flushInput();
  }
}

async function flushActions(): Promise<void> {
  if (actionSendInFlight) return;
  const message = actionQueue.shift();
  if (!message) return;
  actionSendInFlight = true;
  try {
    await client.streams.send(message);
  } catch {
    // Actions are bounded and intentionally not retried after disconnect.
  } finally {
    actionSendInFlight = false;
    if (actionQueue.length > 0) void flushActions();
  }
}

function onKeyDown(event: KeyboardEvent): void {
  unlockAudio();
  if (
    event.code === "Escape" &&
    document.body.classList.contains("is-docked") &&
    !dockPanelCollapsed
  ) {
    event.preventDefault();
    dockPanelCollapsed = true;
    applyDockPanelState();
    dockCollapse.focus({ preventScroll: true });
    return;
  }
  if (import.meta.env.DEV && event.code === "KeyT" && !event.repeat) {
    touchMouseEmulation = !touchMouseEmulation;
    if (touchMouseEmulation) activateTouchControls();
    resetInputState();
    sendInput();
    return;
  }
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
    event.preventDefault();
  }
  keys.add(event.code);
  if (event.code === "Space") sendInput();
  if (event.repeat) {
    return;
  }
  if (event.code === "KeyR") sendAction("repair");
}

function onKeyUp(event: KeyboardEvent): void {
  keys.delete(event.code);
  if (event.code === "Space") sendInput();
}

function touchOverride(): string | null {
  const queryValue = new URLSearchParams(window.location.search).get("touch");
  if (queryValue !== null) return queryValue;
  try {
    return window.localStorage.getItem("snack-touch");
  } catch {
    return null;
  }
}

function isTouchDevice(): boolean {
  const override = touchOverride();
  if (override === "1" || override === "true") return true;
  if (override === "0" || override === "false") return false;
  return (
    (window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? false) ||
    (navigator.maxTouchPoints ?? 0) > 0
  );
}

function setupTouchControls(): void {
  canvas.addEventListener("touchstart", preventTouchGesture, { passive: false });
  if (touchControlsEnabled) activateTouchControls();
}

function activateTouchControls(): void {
  document.body.classList.add("touch-controls");
  required<HTMLElement>("#prompt").textContent =
    "LEFT DRAG MOVE · RIGHT DRAG AIM + FIRE · ENTER MOTHERSHIP TO UPGRADE";
}

function preventTouchGesture(event: TouchEvent): void {
  event.preventDefault();
}

function createTouchStick(event: PointerEvent): TouchStick {
  return {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY,
  };
}

function touchStickVector(stick: TouchStick): { x: number; y: number } {
  const dx = stick.currentX - stick.startX;
  const dy = stick.currentY - stick.startY;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { x: 0, y: 0 };
  const magnitude = Math.min(1, distance / TOUCH_STICK_RADIUS);
  if (magnitude < TOUCH_STICK_DEAD_ZONE) return { x: 0, y: 0 };
  const strength = (magnitude - TOUCH_STICK_DEAD_ZONE) / (1 - TOUCH_STICK_DEAD_ZONE);
  return { x: (dx / distance) * strength, y: (dy / distance) * strength };
}

function updateTouchAim(): void {
  if (!touchAim) return;
  const vector = touchStickVector(touchAim);
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude === 0) {
    pointerFire = false;
    return;
  }
  const distance = Math.max(150, Math.min(viewportWidth(), viewportHeight()) * 0.42);
  aimScreenX = viewportWidth() / 2 + (vector.x / magnitude) * distance;
  aimScreenY = viewportHeight() / 2 + (vector.y / magnitude) * distance;
  pointerFire = true;
}

function teachTouchControl(control: "move" | "aim"): void {
  document.body.classList.add(control === "move" ? "touch-move-learned" : "touch-aim-learned");
  if (touchGuideTimer !== 0) return;
  touchGuideTimer = window.setTimeout(() => {
    document.body.classList.add("touch-move-learned", "touch-aim-learned");
    touchGuideTimer = 0;
  }, TOUCH_GUIDE_TIMEOUT_MS);
}

function isTouchControlPointer(event: PointerEvent): boolean {
  return (
    event.pointerType === "touch" ||
    (import.meta.env.DEV && event.pointerType === "mouse" && touchMouseEmulation)
  );
}

function onPointerDown(event: PointerEvent): void {
  unlockAudio();
  if (isTouchControlPointer(event)) {
    event.preventDefault();
    activateTouchControls();
    if (event.clientX < viewportWidth() * TOUCH_MOVE_SIDE_FRACTION && !touchMove) {
      touchMove = createTouchStick(event);
      teachTouchControl("move");
    } else if (!touchAim) {
      touchAim = createTouchStick(event);
      pointerFire = false;
      teachTouchControl("aim");
    }
    inputSurface.setPointerCapture(event.pointerId);
    sendInput();
    return;
  }
  inputSurface.setPointerCapture(event.pointerId);
  aimScreenX = event.clientX;
  aimScreenY = event.clientY;
  pointerFire = true;
  sendInput();
}

function onPointerMove(event: PointerEvent): void {
  if (touchMove?.id === event.pointerId) {
    touchMove.currentX = event.clientX;
    touchMove.currentY = event.clientY;
    return;
  }
  if (touchAim?.id === event.pointerId) {
    touchAim.currentX = event.clientX;
    touchAim.currentY = event.clientY;
    updateTouchAim();
    return;
  }
  if (event.pointerType === "touch") return;
  aimScreenX = event.clientX;
  aimScreenY = event.clientY;
}

function onPointerUp(event: PointerEvent): void {
  if (touchMove?.id === event.pointerId) touchMove = undefined;
  if (touchAim?.id === event.pointerId) {
    touchAim = undefined;
    pointerFire = false;
  }
  if (event.pointerType !== "touch") pointerFire = false;
  if (inputSurface.hasPointerCapture(event.pointerId)) {
    inputSurface.releasePointerCapture(event.pointerId);
  }
  sendInput();
}

function render(now: number): void {
  const renderStartedAt = performance.now();
  const frameMs = now - lastFrameAt;
  const frameSeconds = clamp(frameMs / 1000, 0, 0.05);
  lastFrameAt = now;
  advancePrediction(frameSeconds);
  updateEffects(frameSeconds);
  const dpr = 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = "#02030a";
  context.fillRect(0, 0, width, height);

  updateCamera(frameSeconds);
  const view = getView();
  renderScale = view.scale;
  frameGlowCalls = 0;
  frameVisibleEntities = 0;
  context.setTransform(
    dpr * view.scale,
    0,
    0,
    dpr * view.scale,
    dpr * (view.offsetX + shakeX),
    dpr * (view.offsetY + shakeY),
  );
  drawWorldBackdrop(now);
  drawStars();

  if (snapshot) {
    for (const base of snapshot.motherships) drawMothershipField(base, now);
    for (const asteroid of snapshot.asteroids) {
      if (!isWorldVisible(asteroid.x, asteroid.y, asteroid.radius + 30)) continue;
      frameVisibleEntities += 1;
      drawAsteroid(asteroid);
    }
    for (const item of visibleSalvage) {
      const position = smoothSalvagePosition(item, now, frameSeconds);
      if (!isWorldVisible(position.x, position.y, 24)) continue;
      frameVisibleEntities += 1;
      drawSalvage(position.x, position.y, item.value, item.team, now);
    }
    for (const base of snapshot.motherships) {
      if (!isWorldVisible(base.x, base.y, Math.max(base.width, base.height) / 2 + 50)) continue;
      frameVisibleEntities += 1;
      drawMothership(base, now);
    }
    for (const projectile of snapshot.projectiles) {
      if (!isWorldVisible(projectile.x, projectile.y, 80)) continue;
      frameVisibleEntities += 1;
      drawProjectile(projectile, now);
    }
    for (const ship of snapshot.ships) {
      if (!isWorldVisible(ship.x, ship.y, 80)) continue;
      frameVisibleEntities += 1;
      drawShip(ship, now, frameSeconds);
    }
  }
  drawEffects();

  drawRadar(dpr, width, height);
  drawTouchControl(dpr);
  drawDeepSpaceGuide(dpr, width, height, now);
  recordPerformance(frameMs, performance.now() - renderStartedAt, now);
  requestAnimationFrame(render);
}

function smoothSalvagePosition(
  item: SalvageView,
  now: number,
  frameSeconds: number,
): { x: number; y: number } {
  const display = salvageDisplays.get(item.id);
  if (!display) return item;
  const extrapolation = Math.min(
    SALVAGE_MAX_EXTRAPOLATION_SECONDS,
    Math.max(0, (now - display.targetAt) / 1000),
  );
  const targetX = display.targetX + display.vx * extrapolation;
  const targetY = display.targetY + display.vy * extrapolation;
  const blend = 1 - Math.exp(-SALVAGE_POSITION_RESPONSE * frameSeconds);
  display.x += (targetX - display.x) * blend;
  display.y += (targetY - display.y) * blend;
  return display;
}

function recordPerformance(frameMs: number, renderMs: number, now: number): void {
  frameSamples[performanceSampleIndex] = frameMs;
  renderSamples[performanceSampleIndex] = renderMs;
  performanceSampleIndex = (performanceSampleIndex + 1) % frameSamples.length;
  performanceSampleCount = Math.min(performanceSampleCount + 1, frameSamples.length);
  maxWorkSinceReport = Math.max(maxWorkSinceReport, renderMs);
  maxParticlesSinceReport = Math.max(maxParticlesSinceReport, particles.length);
  maxGlowCallsSinceReport = Math.max(maxGlowCallsSinceReport, frameGlowCalls);
  maxVisibleEntitiesSinceReport = Math.max(maxVisibleEntitiesSinceReport, frameVisibleEntities);
  if (!import.meta.env.DEV || now < nextPerformanceReportAt || performanceSampleCount < 30) return;
  nextPerformanceReportAt = now + 500;
  const frames = Array.from(frameSamples.slice(0, performanceSampleCount)).sort((a, b) => a - b);
  const renders = Array.from(renderSamples.slice(0, performanceSampleCount)).sort((a, b) => a - b);
  const percentile = (values: number[], ratio: number): number =>
    values[Math.min(values.length - 1, Math.floor(values.length * ratio))] ?? 0;
  const rafP50 = percentile(frames, 0.5);
  const rafP95 = percentile(frames, 0.95);
  const workP50 = percentile(renders, 0.5);
  const workP95 = percentile(renders, 0.95);
  required<HTMLOutputElement>("#performance-state").value = [
    `mode=canvas-direct-1x`,
    `raf-p50=${rafP50.toFixed(2)}ms`,
    `raf-p95=${rafP95.toFixed(2)}ms`,
    `raf-hz=${(1000 / Math.max(rafP50, 0.01)).toFixed(1)}`,
    `work-p50=${workP50.toFixed(2)}ms`,
    `work-p95=${workP95.toFixed(2)}ms`,
    `work-max=${maxWorkSinceReport.toFixed(2)}ms`,
    `source=${canvas.width}x${canvas.height}`,
    `particles=${particles.length}`,
    `effect-peak=${maxParticlesSinceReport}`,
    `effect-draws=${maxEffectDrawCallsSinceReport}`,
    `glows=${maxGlowCallsSinceReport}`,
    `visible=${maxVisibleEntitiesSinceReport}`,
    `simulation=60hz-fixed`,
    `sim-steps-max=${maxPredictionStepsSinceReport}`,
    `protocol=binary-v${PROTOCOL_VERSION}`,
    `snapshot=${lastSnapshotBytes}B`,
    `salvage-packet=${lastSalvageBytes}B`,
  ].join(" ");
  maxWorkSinceReport = 0;
  maxParticlesSinceReport = particles.length;
  maxEffectDrawCallsSinceReport = 0;
  maxGlowCallsSinceReport = 0;
  maxVisibleEntitiesSinceReport = 0;
  maxPredictionStepsSinceReport = 0;
}

function bindInputSurface(surface: HTMLCanvasElement): void {
  if (inputSurface !== surface) {
    inputSurface.removeEventListener("contextmenu", preventContextMenu);
    inputSurface.removeEventListener("pointerdown", onPointerDown);
    inputSurface.removeEventListener("pointermove", onPointerMove);
    inputSurface.removeEventListener("pointerup", onPointerUp);
    inputSurface.removeEventListener("pointercancel", onPointerUp);
  }
  surface.addEventListener("contextmenu", preventContextMenu);
  surface.addEventListener("pointerdown", onPointerDown);
  surface.addEventListener("pointermove", onPointerMove);
  surface.addEventListener("pointerup", onPointerUp);
  surface.addEventListener("pointercancel", onPointerUp);
}

function preventContextMenu(event: Event): void {
  event.preventDefault();
}

function resetInputState(): void {
  keys.clear();
  pointerFire = false;
  touchMove = undefined;
  touchAim = undefined;
  currentInput = { moveX: 0, moveY: 0, fire: false };
}

function observeProjectiles(message: SnapshotMessage): void {
  const live = new Set<number>();
  for (const projectile of message.projectiles) {
    live.add(projectile.id);
    if (!projectilesInitialized || knownProjectiles.has(projectile.id)) continue;
    knownProjectiles.add(projectile.id);
    if (projectile.kind === "turret") observeTurretAngle(message, projectile);
    if (projectile.ownerId === message.selfId) continue;
    const distance = Math.hypot(projectile.x - cameraX, projectile.y - cameraY);
    if (distance > 1250) continue;
    const color = projectile.kind === "turret" ? "#ffffff" : TEAM_COLORS[projectile.team];
    flashes.push({
      x: projectile.x,
      y: projectile.y,
      life: 0.09,
      maxLife: 0.09,
      radius: projectile.kind === "needle" ? 15 : 8,
      color,
    });
    playWeaponSound(projectile.kind, 0.28 * (1 - distance / 1600));
  }
  knownProjectiles.clear();
  for (const id of live) knownProjectiles.add(id);
  projectilesInitialized = true;
}

function observeTurretAngle(message: SnapshotMessage, projectile: ProjectileView): void {
  const base = message.motherships.find((candidate) => candidate.team === projectile.team);
  if (!base) return;
  let nearestIndex = -1;
  let nearestDistance = 90;
  for (let index = 0; index < MOTHERSHIP_TURRET_MOUNTS.length; index += 1) {
    const mount = MOTHERSHIP_TURRET_MOUNTS[index];
    const x = base.x + mount.xFactor * base.width + mount.normalX * 12;
    const y = base.y + mount.yFactor * base.height + mount.normalY * 12;
    const distance = Math.hypot(projectile.x - x, projectile.y - y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }
  if (nearestIndex >= 0) {
    turretAngles.set(`${base.team}:${nearestIndex}`, Math.atan2(projectile.vy, projectile.vx));
  }
}

function triggerImmediateWeapon(now: number): void {
  const self = snapshot?.ships.find((ship) => ship.id === snapshot?.selfId);
  if (!self?.alive || !predictedSelf || now < nextLocalFireAt) return;
  const physics = SHIP_PHYSICS[self.shipClass];
  const weapon = SHIP_WEAPONS[self.shipClass];
  if (self.docked && weapon.mode !== "dash") return;
  nextLocalFireAt =
    now + (physics.cooldown * 1000) / (1 + self.stats.weapon * STAT_BONUSES.weaponRatePerLevel);
  const color = TEAM_COLORS[self.team];

  if (weapon.mode === "dash") {
    const impulse = weapon.dashImpulse;
    predictedDashUntil = now + weapon.dashDuration;
    predictedSelf.vx += Math.cos(predictedSelf.angle) * impulse;
    predictedSelf.vy += Math.sin(predictedSelf.angle) * impulse;
    shakeStrength = Math.max(shakeStrength, 3.5 + weapon.dashImpulse / 500);
    spawnMuzzle(predictedSelf.x, predictedSelf.y, predictedSelf.angle + Math.PI, color, 12);
  } else if (weapon.mode === "radial") {
    for (let index = 0; index < weapon.count; index += 1) {
      const angle = (Math.PI * 2 * index) / weapon.count;
      spawnMuzzle(
        predictedSelf.x + Math.cos(angle) * 22,
        predictedSelf.y + Math.sin(angle) * 22,
        angle,
        color,
        2,
      );
    }
  } else if (weapon.mode === "fan") {
    for (const offset of centeredOffsets(weapon.count, weapon.spread)) {
      spawnMuzzle(
        predictedSelf.x + Math.cos(predictedSelf.angle + offset) * 25,
        predictedSelf.y + Math.sin(predictedSelf.angle + offset) * 25,
        predictedSelf.angle + offset,
        color,
        2,
      );
    }
  } else if (weapon.mode === "drone") {
    for (const offset of centeredOffsets(weapon.count, weapon.spread)) {
      spawnMuzzle(
        predictedSelf.x + Math.cos(predictedSelf.angle + offset) * 24,
        predictedSelf.y + Math.sin(predictedSelf.angle + offset) * 24,
        predictedSelf.angle + offset,
        color,
        2,
      );
    }
  } else if (weapon.mode === "fork") {
    for (const offset of centeredOffsets(weapon.count, weapon.spread)) {
      spawnMuzzle(
        predictedSelf.x + Math.cos(predictedSelf.angle + offset) * 36,
        predictedSelf.y + Math.sin(predictedSelf.angle + offset) * 36,
        predictedSelf.angle + offset,
        color,
        6,
      );
    }
  } else {
    const needleClass = weapon.mode === "rail";
    const distance = needleClass ? Math.min(58, physics.radius + 20) : physics.radius + 4;
    spawnMuzzle(
      predictedSelf.x + Math.cos(predictedSelf.angle) * distance,
      predictedSelf.y + Math.sin(predictedSelf.angle) * distance,
      predictedSelf.angle,
      color,
      needleClass ? Math.min(16, 6 + weapon.pierce) : 4,
    );
  }
  playWeaponSound(self.shipClass, 0.72);
}

function spawnMuzzle(x: number, y: number, angle: number, color: string, count: number): void {
  flashes.push({ x, y, life: 0.1, maxLife: 0.1, radius: 7 + count * 0.55, color });
  for (let index = 0; index < count; index += 1) {
    const spread = (Math.random() - 0.5) * 0.8;
    const speed = 55 + Math.random() * 145;
    particles.push({
      x,
      y,
      vx: Math.cos(angle + spread) * speed,
      vy: Math.sin(angle + spread) * speed,
      life: 0.12 + Math.random() * 0.14,
      maxLife: 0.26,
      size: 1 + Math.random() * 1.2,
      rotation: angle,
      spin: 0,
      color,
      fragment: false,
    });
  }
  capEffects();
}

function centeredOffsets(count: number, spread: number): number[] {
  if (count <= 1) return [0];
  return Array.from({ length: count }, (_, index) => -spread / 2 + (spread * index) / (count - 1));
}

function reconcilePrediction(self: ShipView): void {
  if (!self.alive) predictedDashUntil = 0;
  if (!predictedSelf || Math.hypot(predictedSelf.x - self.x, predictedSelf.y - self.y) > 220) {
    predictedSelf = { x: self.x, y: self.y, vx: self.vx, vy: self.vy, angle: self.angle };
    return;
  }
  const correction =
    (self.docked && performance.now() >= predictedDashUntil) || !self.alive ? 1 : 0.16;
  predictedSelf.x += (self.x - predictedSelf.x) * correction;
  predictedSelf.y += (self.y - predictedSelf.y) * correction;
  predictedSelf.vx += (self.vx - predictedSelf.vx) * 0.2;
  predictedSelf.vy += (self.vy - predictedSelf.vy) * 0.2;
}

function advancePrediction(frameSeconds: number): void {
  predictionAccumulator = Math.min(
    predictionAccumulator + frameSeconds,
    PREDICTION_STEP_SECONDS * MAX_PREDICTION_CATCH_UP_STEPS,
  );
  let steps = 0;
  while (
    predictionAccumulator >= PREDICTION_STEP_SECONDS &&
    steps < MAX_PREDICTION_CATCH_UP_STEPS
  ) {
    updatePrediction(PREDICTION_STEP_SECONDS);
    predictionAccumulator -= PREDICTION_STEP_SECONDS;
    steps += 1;
  }
  maxPredictionStepsSinceReport = Math.max(maxPredictionStepsSinceReport, steps);
}

function updatePrediction(dt: number): void {
  const self = snapshot?.ships.find((ship) => ship.id === snapshot?.selfId);
  if (!self || !predictedSelf) return;
  if (!self.alive) {
    reconcilePrediction(self);
    return;
  }

  const physics = SHIP_PHYSICS[self.shipClass];
  const engine = 1 + self.stats.engine * STAT_BONUSES.enginePerLevel;
  predictedSelf.vx += currentInput.moveX * physics.acceleration * engine * dt;
  predictedSelf.vy += currentInput.moveY * physics.acceleration * engine * dt;
  const weapon = SHIP_WEAPONS[self.shipClass];
  const predictedDashing = self.dashing || performance.now() < predictedDashUntil;
  const drag = Math.exp(-physics.drag * dt * (predictedDashing ? 0.25 : 1));
  predictedSelf.vx *= drag;
  predictedSelf.vy *= drag;
  const dashSpeed = Math.max(physics.speed * 1.9, weapon.dashImpulse);
  const maximum = (predictedDashing ? dashSpeed : physics.speed) * engine;
  const speed = Math.hypot(predictedSelf.vx, predictedSelf.vy);
  if (speed > maximum) {
    predictedSelf.vx = (predictedSelf.vx / speed) * maximum;
    predictedSelf.vy = (predictedSelf.vy / speed) * maximum;
  }
  predictedSelf.x += predictedSelf.vx * dt;
  predictedSelf.y += predictedSelf.vy * dt;
  const aim = screenToWorld(aimScreenX, aimScreenY);
  predictedSelf.angle = Math.atan2(aim.y - predictedSelf.y, aim.x - predictedSelf.x);

  for (const asteroid of snapshot?.asteroids ?? []) {
    const position = extrapolatedAsteroidPosition(asteroid);
    resolvePredictedCircle(position.x, position.y, asteroid.radius + physics.radius);
  }
}

function resolvePredictedCircle(x: number, y: number, minimumDistance: number): void {
  if (!predictedSelf) return;
  const dx = predictedSelf.x - x;
  const dy = predictedSelf.y - y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 0 || distance >= minimumDistance) return;
  const nx = dx / distance;
  const ny = dy / distance;
  predictedSelf.x += nx * (minimumDistance - distance);
  predictedSelf.y += ny * (minimumDistance - distance);
  const impactSpeed = predictedSelf.vx * nx + predictedSelf.vy * ny;
  if (impactSpeed < 0) {
    predictedSelf.vx -= impactSpeed * nx * 1.4;
    predictedSelf.vy -= impactSpeed * ny * 1.4;
  }
}

function updateCamera(frameSeconds: number): void {
  const self = snapshot?.ships.find((ship) => ship.id === snapshot?.selfId);
  if (!self) {
    return;
  }
  const display = predictedSelf ?? displayShips.get(self.id);
  const targetX = predictedSelf
    ? predictedSelf.x + predictedSelf.vx * predictionAccumulator
    : (display?.x ?? self.x);
  const targetY = predictedSelf
    ? predictedSelf.y + predictedSelf.vy * predictionAccumulator
    : (display?.y ?? self.y);
  cameraX = targetX;
  cameraY = targetY;
  const targetScale = CAMERA_SCALE_BY_TIER[shipTransformTier(self.shipClass)] ?? 1;
  const scaleBlend = reducedMotion.matches ? 1 : 1 - Math.exp(-CAMERA_ZOOM_RESPONSE * frameSeconds);
  cameraTierScale += (targetScale - cameraTierScale) * scaleBlend;
}

function visibleWorldBounds(padding = 0): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const halfWidth = viewportWidth() / (renderScale * 2) + padding;
  const halfHeight = viewportHeight() / (renderScale * 2) + padding;
  return {
    left: cameraX - halfWidth,
    right: cameraX + halfWidth,
    top: cameraY - halfHeight,
    bottom: cameraY + halfHeight,
  };
}

function drawWorldBackdrop(now: number): void {
  const bounds = visibleWorldBounds(VECTOR_GRID_SPACING);
  const firstColumn = Math.floor(bounds.left / VECTOR_GRID_SPACING);
  const lastColumn = Math.ceil(bounds.right / VECTOR_GRID_SPACING);
  const firstRow = Math.floor(bounds.top / VECTOR_GRID_SPACING);
  const lastRow = Math.ceil(bounds.bottom / VECTOR_GRID_SPACING);

  context.save();
  context.globalCompositeOperation = "source-over";
  context.lineCap = "butt";
  context.strokeStyle = "#386079";
  context.globalAlpha = 0.095;
  context.lineWidth = 0.55 / renderScale;
  context.beginPath();
  for (let column = firstColumn; column <= lastColumn; column += 1) {
    if (column % VECTOR_GRID_MAJOR_INTERVAL === 0) continue;
    const x = column * VECTOR_GRID_SPACING;
    context.moveTo(x, bounds.top);
    context.lineTo(x, bounds.bottom);
  }
  for (let row = firstRow; row <= lastRow; row += 1) {
    if (row % VECTOR_GRID_MAJOR_INTERVAL === 0) continue;
    const y = row * VECTOR_GRID_SPACING;
    context.moveTo(bounds.left, y);
    context.lineTo(bounds.right, y);
  }
  context.stroke();

  context.strokeStyle = "#4b7893";
  context.globalAlpha = 0.16;
  context.lineWidth = 0.85 / renderScale;
  context.beginPath();
  for (let column = firstColumn; column <= lastColumn; column += 1) {
    if (column % VECTOR_GRID_MAJOR_INTERVAL !== 0) continue;
    const x = column * VECTOR_GRID_SPACING;
    context.moveTo(x, bounds.top);
    context.lineTo(x, bounds.bottom);
  }
  for (let row = firstRow; row <= lastRow; row += 1) {
    if (row % VECTOR_GRID_MAJOR_INTERVAL !== 0) continue;
    const y = row * VECTOR_GRID_SPACING;
    context.moveTo(bounds.left, y);
    context.lineTo(bounds.right, y);
  }
  context.stroke();

  drawNavigationTraces(now, bounds);
  context.restore();
}

function drawNavigationTraces(
  now: number,
  bounds: { left: number; right: number; top: number; bottom: number },
): void {
  const centerX = WORLD_WIDTH / 2;
  const centerY = WORLD_HEIGHT / 2;
  const laneStart = WORLD_WIDTH * 0.23;
  const laneEnd = WORLD_WIDTH * 0.77;
  if (
    bounds.right >= laneStart &&
    bounds.left <= laneEnd &&
    bounds.bottom >= NAVIGATION_LANE_Y[0] &&
    bounds.top <= NAVIGATION_LANE_Y[NAVIGATION_LANE_Y.length - 1]
  ) {
    context.setLineDash([28 / renderScale, 54 / renderScale]);
    context.lineDashOffset = reducedMotion.matches ? 0 : (-now * 0.012) / renderScale;
    context.globalAlpha = 0.15;
    context.lineWidth = 0.9 / renderScale;
    context.strokeStyle = TEAM_COLORS.cyan;
    context.beginPath();
    for (const y of NAVIGATION_LANE_Y) {
      if (y < bounds.top || y > bounds.bottom) continue;
      const start = Math.max(laneStart, bounds.left);
      const end = Math.min(centerX - 70, bounds.right);
      if (start >= end) continue;
      context.moveTo(start, y);
      context.lineTo(end, y);
    }
    context.stroke();
    context.strokeStyle = TEAM_COLORS.magenta;
    context.beginPath();
    for (const y of NAVIGATION_LANE_Y) {
      if (y < bounds.top || y > bounds.bottom) continue;
      const start = Math.max(centerX + 70, bounds.left);
      const end = Math.min(laneEnd, bounds.right);
      if (start >= end) continue;
      context.moveTo(start, y);
      context.lineTo(end, y);
    }
    context.stroke();
    context.setLineDash([]);
  }

  if (
    bounds.right >= centerX - 1550 &&
    bounds.left <= centerX + 1550 &&
    bounds.bottom >= centerY - 850 &&
    bounds.top <= centerY + 850
  ) {
    const phase = reducedMotion.matches ? 0 : now * 0.000035;
    context.strokeStyle = ASTEROID_STYLES.core.color;
    context.globalAlpha = 0.17;
    context.lineWidth = 0.9 / renderScale;
    context.beginPath();
    for (let segment = 0; segment < 8; segment += 1) {
      const start = phase + (Math.PI * 2 * segment) / 8;
      context.ellipse(centerX, centerY, 1450, 760, 0, start, start + 0.46);
    }
    context.stroke();
  }
}

function drawMothershipField(base: MothershipView, now: number): void {
  if (base.hp <= 0) return;
  const outerRadius = 920;
  if (!isWorldVisible(base.x, base.y, outerRadius + 30)) return;
  const color = TEAM_COLORS[base.team];
  const direction = base.team === "cyan" ? 1 : -1;
  const phase = reducedMotion.matches ? 0 : now * 0.000045 * direction;

  context.save();
  context.globalCompositeOperation = "lighter";
  context.strokeStyle = color;
  context.globalAlpha = 0.2;
  context.lineWidth = 1.05 / renderScale;
  context.setLineDash([310, 270]);
  context.lineDashOffset = reducedMotion.matches ? 0 : -phase * outerRadius;
  context.beginPath();
  context.arc(base.x, base.y, outerRadius, 0, Math.PI * 2);
  context.stroke();

  context.globalAlpha = 0.11;
  context.lineWidth = 0.75 / renderScale;
  context.setLineDash([185, 355]);
  context.lineDashOffset = reducedMotion.matches ? 0 : phase * 930;
  context.beginPath();
  context.arc(base.x, base.y, 690, 0, Math.PI * 2);
  context.stroke();

  context.globalAlpha = 0.28;
  context.lineWidth = 0.9 / renderScale;
  context.setLineDash([]);
  context.beginPath();
  for (let tick = 0; tick < 8; tick += 1) {
    const angle = phase + (Math.PI * 2 * tick) / 8;
    const inner = outerRadius - (tick % 2 === 0 ? 24 : 13);
    context.moveTo(base.x + Math.cos(angle) * inner, base.y + Math.sin(angle) * inner);
    context.lineTo(base.x + Math.cos(angle) * outerRadius, base.y + Math.sin(angle) * outerRadius);
  }
  context.stroke();
  context.restore();
}

function drawStars(): void {
  context.save();
  context.fillStyle = "#d8f7ff";
  const cellSize = 240;
  const halfWidth = viewportWidth() / (renderScale * 2);
  const halfHeight = viewportHeight() / (renderScale * 2);
  const firstColumn = Math.floor((cameraX - halfWidth) / cellSize) - 1;
  const lastColumn = Math.floor((cameraX + halfWidth) / cellSize) + 1;
  const firstRow = Math.floor((cameraY - halfHeight) / cellSize) - 1;
  const lastRow = Math.floor((cameraY + halfHeight) / cellSize) + 1;
  context.beginPath();
  for (let column = firstColumn; column <= lastColumn; column += 1) {
    for (let row = firstRow; row <= lastRow; row += 1) {
      const random = seeded(((column * 73_856_093) ^ (row * 19_349_663)) >>> 0);
      let firstX = 0;
      let firstY = 0;
      for (let index = 0; index < 2; index += 1) {
        const x = (column + random()) * cellSize;
        const y = (row + random()) * cellSize;
        const strength = random();
        if (index === 0) {
          firstX = x;
          firstY = y;
        } else if (strength > 0.7 && (column + row) % 3 === 0) {
          context.moveTo(firstX, firstY);
          context.lineTo(x, y);
        }
        context.globalAlpha = 0.2 + strength * 0.62;
        const size = (strength > 0.9 ? 1.8 : 1.15) / renderScale;
        context.fillRect(x, y, size, size);
      }
    }
  }
  context.globalAlpha = 0.1;
  context.strokeStyle = "#8fc8dc";
  context.lineWidth = 0.65 / renderScale;
  context.stroke();
  context.restore();
}

function drawAsteroid(asteroid: AsteroidView): void {
  const style = ASTEROID_STYLES[asteroid.kind];
  let cached = asteroidPaths.get(asteroid.id);
  if (
    !cached ||
    cached.seed !== asteroid.seed ||
    cached.radius !== asteroid.radius ||
    cached.kind !== asteroid.kind
  ) {
    const path = new Path2D();
    const random = seeded(asteroid.seed);
    for (let index = 0; index < style.vertices; index += 1) {
      const angle = (Math.PI * 2 * index) / style.vertices;
      const radius = asteroid.radius * (0.82 + random() * style.jitter);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (index === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
    cached = { seed: asteroid.seed, radius: asteroid.radius, kind: asteroid.kind, path };
    asteroidPaths.set(asteroid.id, cached);
  }
  const position = extrapolatedAsteroidPosition(asteroid);
  const integrity = asteroid.hp / asteroid.maxHp;
  context.save();
  context.translate(position.x, position.y);
  glowStroke(cached.path, style.color, 1.15, 0.58 + integrity * 0.42);
  glowDot(0, 0, (2.2 + asteroid.radius * 0.032) * style.dotScale, style.color);
  context.restore();
}

function extrapolatedAsteroidPosition(asteroid: AsteroidView): { x: number; y: number } {
  const elapsed = Math.min(0.09, Math.max(0, (performance.now() - snapshotReceivedAt) / 1000));
  return {
    x: asteroid.x + asteroid.vx * elapsed,
    y: asteroid.y + asteroid.vy * elapsed,
  };
}

function drawSalvage(
  x: number,
  y: number,
  value: number,
  team: Team | undefined,
  now: number,
): void {
  const pulse = 1 + Math.sin(now * 0.006 + value) * 0.22;
  const radius = (3 + Math.min(3, value * 0.15)) * pulse;
  const color = team ? TEAM_COLORS[team] : "#efff4d";
  const path = new Path2D();
  path.moveTo(x, y - radius);
  path.lineTo(x + radius, y);
  path.lineTo(x, y + radius);
  path.lineTo(x - radius, y);
  path.closePath();
  glowStroke(path, color, 1.35, 1);
}

function drawMothership(base: MothershipView, now: number): void {
  if (base.hp <= 0) return;
  const color = TEAM_COLORS[base.team];
  const alpha = 0.72 + (base.hp / base.maxHp) * 0.28;
  drawMothershipUpgradeBay(base, now);
  glowStroke(mothershipPath(base), color, 1.5, alpha);

  const innerX = base.x + (base.team === "cyan" ? base.width / 2 : -base.width / 2);
  const ports = mothershipPortOffsets(base);
  for (let index = 0; index < ports.length; index += 1) {
    const y = base.y + ports[index];
    drawTriangle(
      innerX + (base.team === "cyan" ? 18 : -18),
      y,
      base.team === "cyan" ? 0 : Math.PI,
      10,
      color,
      1,
    );
    const pulse = 18 + Math.sin(now * 0.004 + index) * 4;
    const dock = new Path2D();
    dock.arc(innerX, y, pulse, -Math.PI / 2, Math.PI / 2, base.team !== "cyan");
    glowStroke(dock, color, 0.7, 0.22);
  }

  for (let index = 0; index < MOTHERSHIP_TURRET_MOUNTS.length; index += 1) {
    const mount = MOTHERSHIP_TURRET_MOUNTS[index];
    const cannonX = base.x + mount.xFactor * base.width + mount.normalX * 12;
    const cannonY = base.y + mount.yFactor * base.height + mount.normalY * 12;
    const restingAngle = Math.atan2(mount.normalY, mount.normalX);
    const angle = turretAngles.get(`${base.team}:${index}`) ?? restingAngle;
    drawTriangle(cannonX, cannonY, angle, 6.5, color, 0.9);
    const barrel = new Path2D();
    barrel.moveTo(cannonX, cannonY);
    barrel.lineTo(cannonX + Math.cos(angle) * 18, cannonY + Math.sin(angle) * 18);
    glowStroke(barrel, color, 1.1, 0.72);
  }
}

function mothershipUpgradeBay(base: MothershipView): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const width = Math.min(260, base.width * 0.62);
  const height = Math.min(240, base.height * 0.18);
  return {
    left: base.x - width / 2,
    top: base.y - height / 2,
    width,
    height,
  };
}

function drawMothershipUpgradeBay(base: MothershipView, now: number): void {
  const bay = mothershipUpgradeBay(base);
  const color = TEAM_COLORS[base.team];
  const stripeStep = 32;
  const stripePhase = reducedMotion.matches ? 0 : (now * 0.006) % stripeStep;

  context.save();
  context.fillStyle = color;
  context.globalAlpha = 0.035;
  context.fillRect(bay.left, bay.top, bay.width, bay.height);
  context.beginPath();
  context.rect(bay.left, bay.top, bay.width, bay.height);
  context.clip();
  context.globalCompositeOperation = "lighter";
  context.strokeStyle = color;
  context.globalAlpha = 0.17;
  context.lineWidth = 1.15 / renderScale;
  context.beginPath();
  for (
    let stripeX = bay.left - bay.height + stripePhase;
    stripeX < bay.left + bay.width;
    stripeX += stripeStep
  ) {
    context.moveTo(stripeX, bay.top);
    context.lineTo(stripeX + bay.height, bay.top + bay.height);
  }
  context.stroke();
  context.restore();

  const outline = new Path2D();
  outline.rect(bay.left, bay.top, bay.width, bay.height);
  glowStroke(outline, color, 0.85, 0.48, 0.65);

  context.save();
  context.fillStyle = "#02030a";
  context.globalAlpha = 0.84;
  context.fillRect(base.x - 82, base.y - 21, 164, 42);
  context.font = "700 24px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.strokeStyle = "#02030a";
  context.lineWidth = 4 / renderScale;
  context.strokeText("UPGRADE", base.x, base.y + 1);
  context.fillStyle = color;
  context.globalAlpha = 0.95;
  context.fillText("UPGRADE", base.x, base.y + 1);
  context.restore();
}

function mothershipPath(base: MothershipView): Path2D {
  const cached = mothershipPaths.get(base.team);
  if (cached) return cached;
  const path = new Path2D();
  const left = base.x - base.width / 2;
  const right = base.x + base.width / 2;
  const top = base.y - base.height / 2;
  const bottom = base.y + base.height / 2;
  const ports = mothershipPortOffsets(base).map((offset) => base.y + offset);
  if (base.team === "cyan") {
    path.moveTo(left, top);
    path.lineTo(right, top);
    for (const y of ports) {
      path.lineTo(right, y - 31);
      path.lineTo(right - 28, y - 31);
      path.lineTo(right - 28, y + 31);
      path.lineTo(right, y + 31);
    }
    path.lineTo(right, bottom);
    path.lineTo(left, bottom);
  } else {
    path.moveTo(right, top);
    path.lineTo(left, top);
    for (const y of ports) {
      path.lineTo(left, y - 31);
      path.lineTo(left + 28, y - 31);
      path.lineTo(left + 28, y + 31);
      path.lineTo(left, y + 31);
    }
    path.lineTo(left, bottom);
    path.lineTo(right, bottom);
  }
  path.closePath();
  mothershipPaths.set(base.team, path);
  return path;
}

function mothershipPortOffsets(base: MothershipView): number[] {
  return [-base.height * 0.315, 0, base.height * 0.315];
}

function drawProjectile(projectile: ProjectileView, now: number): void {
  const elapsed = Math.min(0.09, Math.max(0, (performance.now() - snapshotReceivedAt) / 1000));
  const x = projectile.x + projectile.vx * elapsed;
  const y = projectile.y + projectile.vy * elapsed;
  const color = projectile.kind === "turret" ? "#ffffff" : TEAM_COLORS[projectile.team];
  const angle = Math.atan2(projectile.vy, projectile.vx);
  if (projectile.kind === "drone") {
    drawTriangle(x, y, angle, 7, color, 1);
    return;
  }
  const length = projectile.kind === "needle" ? 46 : 12;
  const path = new Path2D();
  path.moveTo(x - Math.cos(angle) * length, y - Math.sin(angle) * length);
  path.lineTo(x + Math.cos(angle) * 3, y + Math.sin(angle) * 3);
  glowStroke(path, color, projectile.kind === "needle" ? 1.8 : 1.2, 1);
  if (projectile.kind === "needle") glowDot(x, y, 2 + Math.sin(now * 0.01), "#ffffff");
}

function drawShip(ship: ShipView, now: number, frameSeconds: number): void {
  if (!ship.alive) {
    return;
  }
  let display = displayShips.get(ship.id);
  if (!display) {
    display = { x: ship.x, y: ship.y, angle: ship.angle };
    displayShips.set(ship.id, display);
  }
  if (ship.id === snapshot?.selfId && predictedSelf) {
    display.x = predictedSelf.x + predictedSelf.vx * predictionAccumulator;
    display.y = predictedSelf.y + predictedSelf.vy * predictionAccumulator;
    const turnBlend = 1 - Math.exp(-LOCAL_TURN_RESPONSE * frameSeconds);
    display.angle = normalizeAngle(
      display.angle + normalizeAngle(predictedSelf.angle - display.angle) * turnBlend,
    );
  } else {
    const positionBlend = 1 - Math.exp(-REMOTE_POSITION_RESPONSE * frameSeconds);
    const turnBlend = 1 - Math.exp(-REMOTE_TURN_RESPONSE * frameSeconds);
    display.x += (ship.x - display.x) * positionBlend;
    display.y += (ship.y - display.y) * positionBlend;
    display.angle = normalizeAngle(
      display.angle + normalizeAngle(ship.angle - display.angle) * turnBlend,
    );
  }
  const color = TEAM_COLORS[ship.team];
  const physics = SHIP_PHYSICS[ship.shipClass];
  const homeBase = snapshot?.motherships.find((base) => base.team === ship.team);
  const rookieProtected = !ship.docked && rookieProtectionState(ship, homeBase);

  if (Math.hypot(ship.vx, ship.vy) > 45 && !ship.docked) {
    const velocityAngle = Math.atan2(ship.vy, ship.vx);
    const trail = new Path2D();
    const length = Math.min(42, Math.hypot(ship.vx, ship.vy) * 0.11);
    trail.moveTo(
      display.x - Math.cos(velocityAngle) * 10,
      display.y - Math.sin(velocityAngle) * 10,
    );
    trail.lineTo(
      display.x - Math.cos(velocityAngle) * (10 + length),
      display.y - Math.sin(velocityAngle) * (10 + length),
    );
    glowStroke(trail, color, ship.dashing ? 3 : 1.15, ship.dashing ? 1 : 0.6);
  }

  context.save();
  context.translate(display.x, display.y);
  context.rotate(display.angle);
  if (rookieProtected) {
    const shield = new Path2D();
    const shieldRadius = physics.radius + 9;
    for (let segment = 0; segment < 4; segment += 1) {
      const start = segment * (Math.PI / 2) + 0.18;
      shield.arc(0, 0, shieldRadius, start, start + 1.02);
    }
    glowStroke(shield, "#ffffff", 1, 0.52, 0.88);
  }
  const ramImpact = RAM_IMPACT_PROFILES[ship.shipClass];
  if (ship.dashing && ramImpact && ramImpact.arcRadius > 0) {
    const pulse = reducedMotion.matches ? 0 : Math.sin(now * 0.018) * 2;
    const radius = ramImpact.arcRadius + pulse;
    const impactArc = new Path2D();
    impactArc.moveTo(ramImpact.arcOffset, -radius);
    impactArc.arc(ramImpact.arcOffset, 0, radius, -Math.PI / 2, Math.PI / 2);
    impactArc.moveTo(ramImpact.arcOffset, radius);
    impactArc.lineTo(ramImpact.arcOffset, -radius);
    glowStroke(impactArc, color, 1.8, 0.72, 1.35);
  }
  const path = shipPath(ship.shipClass);
  glowStroke(
    path,
    color,
    ship.id === snapshot?.selfId ? 1.75 : 1.3,
    ship.dashing ? 1 : 0.92,
    SHIP_BLOOM_SCALE,
  );
  if (shipTransformTier(ship.shipClass) === 4) {
    const shieldRadius = physics.radius + 11 + Math.sin(now * 0.004 + Number(ship.id)) * 1.5;
    const shield = new Path2D();
    for (let segment = 0; segment < 4; segment += 1) {
      const start = segment * (Math.PI / 2) + 0.13;
      shield.arc(0, 0, shieldRadius, start, start + 1.12);
    }
    glowStroke(shield, "#ffffff", 1.25, 0.58 + Math.sin(now * 0.006) * 0.12);
  }
  const weapon = SHIP_WEAPONS[ship.shipClass];
  if (weapon.mode === "drone") {
    const droneCount = weapon.count;
    const orbitRadius = physics.radius + 12;
    for (let index = 0; index < droneCount; index += 1) {
      const angle = now * 0.0015 + (Math.PI * 2 * index) / droneCount;
      drawTriangle(
        Math.cos(angle) * orbitRadius,
        Math.sin(angle) * orbitRadius,
        angle,
        weapon.pierce > 1 ? 7 : 5.5,
        color,
        0.9,
      );
    }
  }
  context.restore();

  const cargoDots = Math.min(3, Math.ceil(ship.cargo / 10));
  for (let index = 0; index < cargoDots; index += 1) {
    glowDot(
      display.x - 7 + index * 7,
      display.y + physics.radius + 9 / renderScale,
      1.5,
      "#efff4d",
    );
  }
  if (ship.hp < ship.maxHp) {
    const width = Math.max(34, physics.radius * 1.35);
    const pathHp = new Path2D();
    const y = display.y - physics.radius - 9 / renderScale;
    pathHp.moveTo(display.x - width / 2, y);
    pathHp.lineTo(display.x - width / 2 + width * (ship.hp / ship.maxHp), y);
    glowStroke(pathHp, color, 1, 0.75);
  }
  drawName(ship, display.x, display.y);
}

function shipPath(shipClass: ShipClass): Path2D {
  const cached = shipPaths.get(shipClass);
  if (cached) return cached;
  const path = new Path2D();
  if (["lance", "railcore", "deadeye"].includes(shipClass)) {
    const length = shipClass === "deadeye" ? 68 : shipClass === "railcore" ? 60 : 52;
    const halfWidth = shipClass === "deadeye" ? 16 : shipClass === "railcore" ? 13 : 11;
    path.moveTo(length, 0);
    path.lineTo(-30, -halfWidth);
    path.lineTo(-22, 0);
    path.lineTo(-30, halfWidth);
    path.closePath();
    path.moveTo(-18, -halfWidth * 0.45);
    path.lineTo(length - 9, 0);
    path.lineTo(-18, halfWidth * 0.45);
    if (shipClass !== "lance") path.arc(-12, 0, shipClass === "deadeye" ? 10 : 7, 0, Math.PI * 2);
  } else if (["fork", "barrage", "tempest"].includes(shipClass)) {
    const length = shipClass === "tempest" ? 51 : shipClass === "barrage" ? 45 : 38;
    const halfWidth = shipClass === "tempest" ? 22 : shipClass === "barrage" ? 19 : 16;
    path.moveTo(length, -7);
    path.lineTo(-25, -halfWidth);
    path.lineTo(-16, 0);
    path.lineTo(-25, halfWidth);
    path.lineTo(length, 7);
    path.lineTo(17, 0);
    path.closePath();
    if (shipClass !== "fork") {
      path.moveTo(-12, -halfWidth * 0.55);
      path.lineTo(length - 5, -4);
      path.moveTo(-12, halfWidth * 0.55);
      path.lineTo(length - 5, 4);
    }
  } else if (shipClass === "needle") {
    path.moveTo(36, 0);
    path.lineTo(-28, -7);
    path.lineTo(-28, 7);
    path.closePath();
    path.moveTo(-19, 0);
    path.lineTo(25, 0);
  } else if (["brood", "swarm", "queen"].includes(shipClass)) {
    const radius = shipClass === "queen" ? 32 : shipClass === "swarm" ? 27 : 22;
    path.arc(0, 0, radius, 0, Math.PI * 2);
    path.moveTo(-radius, 0);
    path.lineTo(radius, 0);
    path.moveTo(0, -radius);
    path.lineTo(0, radius);
    if (shipClass === "queen") path.arc(0, 0, 13, 0, Math.PI * 2);
  } else if (["bastion", "fortress", "citadel"].includes(shipClass)) {
    const sides = shipClass === "citadel" ? 8 : 6;
    const radius = shipClass === "citadel" ? 40 : shipClass === "fortress" ? 34 : 28;
    for (let index = 0; index < sides; index += 1) {
      const angle = (Math.PI * 2 * index) / sides;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (index === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
    path.arc(0, 0, shipClass === "citadel" ? 20 : 13, 0, Math.PI * 2);
  } else if (shipClass === "hive") {
    path.arc(0, 0, 18, 0, Math.PI * 2);
  } else if (["star", "nova", "supernova", "quasar"].includes(shipClass)) {
    const points =
      shipClass === "quasar" ? 24 : shipClass === "supernova" ? 20 : shipClass === "nova" ? 16 : 12;
    const outer = shipClass === "quasar" ? 38 : shipClass === "supernova" ? 32 : 25;
    for (let index = 0; index < points; index += 1) {
      const angle = (Math.PI * 2 * index) / points;
      const radius = index % 2 === 0 ? outer : outer * 0.4;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (index === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
    if (shipClass !== "star") path.arc(0, 0, outer * 0.36, 0, Math.PI * 2);
  } else if (["prism", "spectrum", "kaleidoscope"].includes(shipClass)) {
    const length = shipClass === "kaleidoscope" ? 46 : shipClass === "spectrum" ? 40 : 34;
    const halfWidth = shipClass === "kaleidoscope" ? 34 : shipClass === "spectrum" ? 29 : 25;
    path.moveTo(length, 0);
    path.lineTo(0, -halfWidth);
    path.lineTo(-28, 0);
    path.lineTo(0, halfWidth);
    path.closePath();
    path.moveTo(length, 0);
    path.lineTo(-8, 0);
    path.moveTo(0, -halfWidth);
    path.lineTo(-8, 0);
    path.lineTo(0, halfWidth);
    if (shipClass === "kaleidoscope") path.arc(-4, 0, 12, 0, Math.PI * 2);
  } else if (["ram", "juggernaut", "behemoth"].includes(shipClass)) {
    const length = shipClass === "behemoth" ? 46 : shipClass === "juggernaut" ? 38 : 31;
    const halfWidth = shipClass === "behemoth" ? 40 : shipClass === "juggernaut" ? 33 : 27;
    path.moveTo(-32, -halfWidth);
    path.lineTo(length, 0);
    path.lineTo(-32, halfWidth);
    path.lineTo(-18, 11);
    path.lineTo(5, 0);
    path.lineTo(-18, -11);
    path.closePath();
  } else if (["comet", "interceptor", "streak"].includes(shipClass)) {
    const length = shipClass === "streak" ? 44 : shipClass === "interceptor" ? 36 : 30;
    const halfWidth = shipClass === "streak" ? 23 : shipClass === "interceptor" ? 19 : 16;
    path.moveTo(-24, -halfWidth);
    path.lineTo(length, 0);
    path.lineTo(-24, halfWidth);
    path.lineTo(-8, 0);
    path.closePath();
    path.moveTo(-8, -8);
    path.lineTo(-34, -8);
    path.moveTo(-8, 8);
    path.lineTo(-34, 8);
  } else if (shipClass === "chevron") {
    path.moveTo(-24, -21);
    path.lineTo(22, 0);
    path.lineTo(-24, 21);
    path.lineTo(-10, 0);
    path.closePath();
  } else {
    path.moveTo(18, 0);
    path.lineTo(-12, -10);
    path.lineTo(-12, 10);
    path.closePath();
  }
  shipPaths.set(shipClass, path);
  return path;
}

function drawName(ship: ShipView, x: number, y: number): void {
  context.save();
  context.globalAlpha = ship.id === snapshot?.selfId ? 0.95 : 0.55;
  context.fillStyle = ship.id === snapshot?.selfId ? "#ffffff" : TEAM_COLORS[ship.team];
  context.font = `${11 / renderScale}px ui-monospace, monospace`;
  context.textAlign = "center";
  context.fillText(
    ship.name.toUpperCase(),
    x,
    y + SHIP_PHYSICS[ship.shipClass].radius + 20 / renderScale,
  );
  context.restore();
}

function drawTriangle(
  x: number,
  y: number,
  angle: number,
  radius: number,
  color: string,
  alpha: number,
): void {
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  const path = new Path2D();
  path.moveTo(radius, 0);
  path.lineTo(-radius * 0.65, -radius * 0.55);
  path.lineTo(-radius * 0.65, radius * 0.55);
  path.closePath();
  glowStroke(path, color, 1.1, alpha);
  context.restore();
}

function glowStroke(
  path: Path2D,
  color: string,
  width: number,
  alpha: number,
  bloomScale = 1,
): void {
  frameGlowCalls += 1;
  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = color;
  context.globalAlpha = alpha * 0.2 * bloomScale;
  context.lineWidth = (5.5 * bloomScale) / renderScale;
  context.stroke(path);
  context.globalAlpha = alpha;
  context.lineWidth = width / renderScale;
  context.stroke(path);
  context.restore();
}

function glowDot(x: number, y: number, radius: number, color: string): void {
  frameGlowCalls += 1;
  context.save();
  context.globalCompositeOperation = "lighter";
  context.fillStyle = color;
  context.globalAlpha = 0.2;
  context.beginPath();
  context.arc(x, y, radius * 2.4, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function isWorldVisible(x: number, y: number, radius: number): boolean {
  const halfWidth = viewportWidth() / (renderScale * 2) + radius;
  const halfHeight = viewportHeight() / (renderScale * 2) + radius;
  return (
    x >= cameraX - halfWidth &&
    x <= cameraX + halfWidth &&
    y >= cameraY - halfHeight &&
    y <= cameraY + halfHeight
  );
}

function spawnImpact(message: EffectMessage): void {
  if (seenEffectIds.has(message.id)) return;
  seenEffectIds.add(message.id);
  effectIdOrder.push(message.id);
  while (effectIdOrder.length > 256) {
    const expired = effectIdOrder.shift();
    if (expired !== undefined) seenEffectIds.delete(expired);
  }

  const pickup = message.kind === "pickup";
  const baseBreak = message.kind === "baseBreak";
  const breaking = message.kind === "asteroidBreak" || message.kind === "shipBreak" || baseBreak;
  const color =
    pickup || message.kind.startsWith("asteroid")
      ? "#efff4d"
      : message.team
        ? TEAM_COLORS[message.team]
        : "#ffffff";
  const motionScale = reducedMotion.matches ? 0.45 : 1;
  const sparkCount = Math.round(
    (baseBreak ? 44 : pickup ? 5 + message.intensity * 4 : 7 + message.intensity * 9) * motionScale,
  );
  for (let index = 0; index < sparkCount; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = baseBreak
      ? 180 + Math.random() * 650
      : (pickup ? 45 + Math.random() * 105 : 90 + Math.random() * 280) *
        (0.6 + message.intensity * 0.35);
    const fragment = breaking && index % (baseBreak ? 2 : 3) === 0;
    const life = baseBreak
      ? fragment
        ? 0.85 + Math.random() * 0.65
        : 0.35 + Math.random() * 0.55
      : fragment
        ? 0.55 + Math.random() * 0.5
        : 0.18 + Math.random() * 0.34;
    particles.push({
      x: message.x + (Math.random() - 0.5) * (baseBreak ? 90 : 5),
      y: message.y + (Math.random() - 0.5) * (baseBreak ? 280 : 5),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life,
      maxLife: life,
      size: fragment
        ? (baseBreak ? 5 : 3) + Math.random() * (baseBreak ? 6 : 4)
        : 1 + Math.random() * (baseBreak ? 2.4 : 1.8),
      rotation: angle,
      spin: fragment ? (Math.random() - 0.5) * 12 : 0,
      color,
      fragment,
    });
  }
  if (baseBreak) {
    for (const [life, radius, ringColor, dotScale] of [
      [0.38, 95, "#ffffff", 0.72],
      [0.64, 165, color, 0.12],
      [0.9, 245, color, 0],
    ] as const) {
      flashes.push({
        x: message.x,
        y: message.y,
        life,
        maxLife: life,
        radius,
        color: ringColor,
        dotScale,
      });
    }
  } else {
    flashes.push({
      x: message.x,
      y: message.y,
      life: breaking ? 0.32 : pickup ? 0.22 : 0.18,
      maxLife: breaking ? 0.32 : pickup ? 0.22 : 0.18,
      radius: (breaking ? 25 : pickup ? 16 : 12) * Math.max(0.75, message.intensity),
      color,
    });
  }
  const distance = Math.hypot(message.x - cameraX, message.y - cameraY);
  const proximity = clamp(1 - distance / 1500, 0, 1);
  if (!pickup && !reducedMotion.matches) {
    shakeStrength = Math.max(
      shakeStrength,
      baseBreak
        ? proximity * Math.min(14, 8 + message.intensity)
        : proximity * message.intensity * (breaking ? 7 : 3.5),
    );
  }
  if (pickup) {
    playPickupSound(message.intensity);
  } else {
    playImpactSound(message, proximity);
  }
  capEffects();
}

function updateEffects(dt: number): void {
  let nextParticle = 0;
  for (let index = 0; index < particles.length; index += 1) {
    const particle = particles[index];
    particle.life -= dt;
    if (particle.life <= 0) continue;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    const drag = Math.exp(-(particle.fragment ? 1.9 : 4.8) * dt);
    particle.vx *= drag;
    particle.vy *= drag;
    particle.rotation += particle.spin * dt;
    particles[nextParticle] = particle;
    nextParticle += 1;
  }
  particles.length = nextParticle;

  let nextFlash = 0;
  for (let index = 0; index < flashes.length; index += 1) {
    const flash = flashes[index];
    flash.life -= dt;
    if (flash.life <= 0) continue;
    flashes[nextFlash] = flash;
    nextFlash += 1;
  }
  flashes.length = nextFlash;
  shakeStrength *= Math.exp(-13 * dt);
  if (shakeStrength < 0.05 || reducedMotion.matches) {
    shakeStrength = 0;
    shakeX = 0;
    shakeY = 0;
  } else {
    shakeX = (Math.random() - 0.5) * shakeStrength;
    shakeY = (Math.random() - 0.5) * shakeStrength;
  }
}

function drawEffects(): void {
  for (const flash of flashes) {
    const alpha = clamp(flash.life / flash.maxLife, 0, 1);
    const progress = 1 - alpha;
    const radius = flash.radius * (0.55 + progress * 1.35);
    const ring = new Path2D();
    ring.arc(flash.x, flash.y, radius, 0, Math.PI * 2);
    glowStroke(ring, flash.color, 1.35 + alpha, alpha * 0.9);
    const dotScale = flash.dotScale ?? 1;
    if (dotScale > 0) {
      glowDot(flash.x, flash.y, Math.max(1.3, flash.radius * alpha * 0.28 * dotScale), "#ffffff");
    }
  }

  const batches = new Map<string, EffectBatch>();
  for (const particle of particles) {
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    const alphaBucket = alpha > 0.66 ? 2 : alpha > 0.33 ? 1 : 0;
    const width = particle.fragment ? 1.4 : particle.size > 1.8 ? 1.8 : 1.1;
    const key = `${particle.color}:${alphaBucket}:${width}`;
    let batch = batches.get(key);
    if (!batch) {
      batch = {
        path: new Path2D(),
        color: particle.color,
        alpha: [0.24, 0.56, 0.92][alphaBucket],
        width,
      };
      batches.set(key, batch);
    }
    if (particle.fragment) {
      const cosine = Math.cos(particle.rotation);
      const sine = Math.sin(particle.rotation);
      const point = (localX: number, localY: number): [number, number] => [
        particle.x + localX * cosine - localY * sine,
        particle.y + localX * sine + localY * cosine,
      ];
      const tip = point(particle.size, 0);
      const upper = point(-particle.size * 0.7, -particle.size * 0.55);
      const lower = point(-particle.size * 0.35, particle.size * 0.8);
      batch.path.moveTo(tip[0], tip[1]);
      batch.path.lineTo(upper[0], upper[1]);
      batch.path.lineTo(lower[0], lower[1]);
      batch.path.closePath();
    } else {
      const speed = Math.hypot(particle.vx, particle.vy);
      const tail = speed > 1 ? Math.min(16, speed * 0.045) : 0;
      const angle = Math.atan2(particle.vy, particle.vx);
      batch.path.moveTo(particle.x, particle.y);
      batch.path.lineTo(particle.x - Math.cos(angle) * tail, particle.y - Math.sin(angle) * tail);
    }
  }

  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const batch of batches.values()) {
    context.strokeStyle = batch.color;
    context.globalAlpha = batch.alpha * 0.72;
    context.lineWidth = (batch.width * 2.2) / renderScale;
    context.stroke(batch.path);
    context.globalAlpha = batch.alpha;
    context.lineWidth = batch.width / renderScale;
    context.stroke(batch.path);
  }
  context.restore();
  maxEffectDrawCallsSinceReport = Math.max(
    maxEffectDrawCallsSinceReport,
    flashes.length * 4 + batches.size * 2,
  );
}

function capEffects(): void {
  if (particles.length > MAX_EFFECT_PARTICLES) {
    particles.splice(0, particles.length - MAX_EFFECT_PARTICLES);
  }
  if (flashes.length > MAX_EFFECT_FLASHES) {
    flashes.splice(0, flashes.length - MAX_EFFECT_FLASHES);
  }
}

function unlockAudio(): void {
  if (!soundEnabled) return;
  if (!audioContext) {
    audioContext = new AudioContext({ latencyHint: "interactive" });
    impactNoise = createNoiseBuffer(audioContext);
  }
  void audioContext.resume();
  soundToggle.textContent = "SOUND · ON";
}

function createNoiseBuffer(audio: AudioContext): AudioBuffer {
  const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.24), audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    const envelope = 1 - index / data.length;
    data[index] = (Math.random() * 2 - 1) * envelope;
  }
  return buffer;
}

function playWeaponSound(kind: ShipClass | ProjectileView["kind"], volume: number): void {
  const audio = audioContext;
  if (!soundEnabled || !audio || audio.state !== "running" || volume <= 0) return;
  const now = audio.currentTime;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const frequencies: Record<string, [number, number]> = {
    scout: [510, 190],
    bolt: [510, 190],
    needle: [980, 145],
    hive: [280, 420],
    drone: [280, 420],
    star: [720, 260],
    chevron: [120, 48],
    lance: [1320, 120],
    fork: [920, 240],
    brood: [240, 470],
    bastion: [170, 75],
    nova: [860, 220],
    prism: [1080, 380],
    ram: [90, 32],
    comet: [190, 65],
    turret: [660, 250],
    rail: [1380, 105],
    radial: [900, 205],
    fan: [1120, 350],
    dash: [105, 38],
  };
  const family = kind in SHIP_WEAPONS ? SHIP_WEAPONS[kind as ShipClass].mode : kind;
  const [start, end] = frequencies[kind] ?? frequencies[family] ?? frequencies.bolt;
  oscillator.type =
    family === "rail" || family === "fork" || kind === "needle"
      ? "sawtooth"
      : family === "dash"
        ? "square"
        : "triangle";
  oscillator.frequency.setValueAtTime(start * (0.97 + Math.random() * 0.06), now);
  oscillator.frequency.exponentialRampToValueAtTime(end, now + 0.09);
  gain.gain.setValueAtTime(Math.max(0.0001, volume * 0.075), now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.11);
}

function playPickupSound(intensity: number): void {
  const audio = audioContext;
  if (!soundEnabled || !audio || audio.state !== "running") return;
  const now = audio.currentTime;
  if (now - lastPickupSoundAt < 0.07) return;
  lastPickupSoundAt = now;
  const volume = clamp(0.035 + intensity * 0.012, 0.035, 0.06);
  for (let note = 0; note < 2; note += 1) {
    const start = now + note * 0.055;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(
      (note === 0 ? 740 : 1110) * (0.98 + Math.random() * 0.04),
      start,
    );
    oscillator.frequency.exponentialRampToValueAtTime(note === 0 ? 930 : 1390, start + 0.075);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.13);
  }
}

function playImpactSound(message: EffectMessage, proximity: number): void {
  const audio = audioContext;
  if (!soundEnabled || !audio || audio.state !== "running" || !impactNoise || proximity <= 0)
    return;
  const now = audio.currentTime;
  const baseBreak = message.kind === "baseBreak";
  const strength = clamp(message.intensity * proximity, 0.08, 1.6);
  const noise = audio.createBufferSource();
  const noiseGain = audio.createGain();
  const filter = audio.createBiquadFilter();
  noise.buffer = impactNoise;
  filter.type = "bandpass";
  filter.frequency.value = baseBreak ? 420 : message.kind.startsWith("asteroid") ? 1700 : 900;
  filter.Q.value = 0.7;
  noiseGain.gain.setValueAtTime((baseBreak ? 0.12 : 0.085) * strength, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + (baseBreak ? 0.23 : 0.16));
  noise.connect(filter).connect(noiseGain).connect(audio.destination);
  noise.start(now);
  noise.stop(now + (baseBreak ? 0.24 : 0.18));

  const thump = audio.createOscillator();
  const thumpGain = audio.createGain();
  thump.type = "sine";
  thump.frequency.setValueAtTime(baseBreak ? 72 : message.kind.includes("Break") ? 110 : 180, now);
  thump.frequency.exponentialRampToValueAtTime(
    baseBreak ? 24 : 45,
    now + (baseBreak ? 0.42 : 0.13),
  );
  thumpGain.gain.setValueAtTime((baseBreak ? 0.085 : 0.055) * strength, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + (baseBreak ? 0.44 : 0.14));
  thump.connect(thumpGain).connect(audio.destination);
  thump.start(now);
  thump.stop(now + (baseBreak ? 0.45 : 0.15));
}

function drawRadar(dpr: number, screenWidth: number, screenHeight: number): void {
  if (!snapshot) {
    return;
  }
  const compact = screenWidth < 760;
  const width = compact ? 116 : 176;
  const height = compact ? 72 : 108;
  const left = compact ? 10 : 20;
  const top = screenHeight - height - (compact ? 36 : 28);
  const padding = 8;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const mapScale = Math.min(innerWidth / WORLD_WIDTH, innerHeight / WORLD_HEIGHT);
  const mapWidth = WORLD_WIDTH * mapScale;
  const mapHeight = WORLD_HEIGHT * mapScale;
  const mapLeft = left + padding + (innerWidth - mapWidth) / 2;
  const mapTop = top + padding + (innerHeight - mapHeight) / 2;
  const mapRight = mapLeft + mapWidth;
  const mapBottom = mapTop + mapHeight;
  const mapX = (x: number): number => mapLeft + (x / WORLD_WIDTH) * mapWidth;
  const mapY = (y: number): number => mapTop + (y / WORLD_HEIGHT) * mapHeight;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.save();
  context.globalCompositeOperation = "source-over";
  context.fillStyle = "#020711d9";
  context.fillRect(left, top, width, height);
  context.strokeStyle = "#65758a88";
  context.lineWidth = 1;
  context.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
  context.fillStyle = "#07111c";
  context.fillRect(mapLeft, mapTop, mapWidth, mapHeight);
  context.strokeStyle = "#65758aaa";
  context.strokeRect(mapLeft + 0.5, mapTop + 0.5, mapWidth - 1, mapHeight - 1);
  context.beginPath();
  context.rect(mapLeft, mapTop, mapWidth, mapHeight);
  context.clip();

  for (const asteroid of snapshot.asteroids) {
    context.fillStyle = `${ASTEROID_STYLES[asteroid.kind].color}88`;
    context.fillRect(mapX(asteroid.x), mapY(asteroid.y), 1.5, 1.5);
  }
  for (const base of snapshot.motherships) {
    context.strokeStyle = TEAM_COLORS[base.team];
    context.beginPath();
    context.moveTo(mapX(base.x), mapY(base.y - base.height / 2));
    context.lineTo(mapX(base.x), mapY(base.y + base.height / 2));
    context.stroke();
  }
  for (const ship of snapshot.ships) {
    if (!ship.alive) continue;
    context.fillStyle = ship.id === snapshot.selfId ? "#ffffff" : TEAM_COLORS[ship.team];
    const shipX = clamp(mapX(ship.x), mapLeft + 2, mapRight - 2);
    const shipY = clamp(mapY(ship.y), mapTop + 2, mapBottom - 2);
    context.beginPath();
    context.arc(shipX, shipY, ship.id === snapshot.selfId ? 2.5 : 1.5, 0, Math.PI * 2);
    context.fill();
  }

  const visibleWorldWidth = screenWidth / renderScale;
  const visibleWorldHeight = screenHeight / renderScale;
  context.strokeStyle = "#ffffff55";
  context.strokeRect(
    mapX(cameraX - visibleWorldWidth / 2),
    mapY(cameraY - visibleWorldHeight / 2),
    visibleWorldWidth * mapScale,
    visibleWorldHeight * mapScale,
  );
  context.restore();
}

function drawTouchControl(dpr: number): void {
  if (!touchMove && !touchAim) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.save();
  context.globalCompositeOperation = "lighter";
  if (touchMove) drawTouchStick(touchMove, "#63fff3");
  if (touchAim) drawTouchStick(touchAim, "#ff5eaa");
  context.restore();
}

function drawTouchStick(stick: TouchStick, color: string): void {
  const dx = stick.currentX - stick.startX;
  const dy = stick.currentY - stick.startY;
  const distance = Math.hypot(dx, dy);
  const scale = distance > TOUCH_STICK_RADIUS ? TOUCH_STICK_RADIUS / distance : 1;
  const knobX = stick.startX + dx * scale;
  const knobY = stick.startY + dy * scale;

  context.strokeStyle = color;
  context.globalAlpha = 0.38;
  context.lineWidth = 1.4;
  context.beginPath();
  context.arc(stick.startX, stick.startY, TOUCH_STICK_RADIUS, 0, Math.PI * 2);
  context.stroke();

  context.globalAlpha = 0.22;
  context.beginPath();
  context.moveTo(stick.startX, stick.startY);
  context.lineTo(knobX, knobY);
  context.stroke();

  context.globalAlpha = 0.72;
  context.lineWidth = 2;
  context.beginPath();
  context.arc(knobX, knobY, 17, 0, Math.PI * 2);
  context.stroke();

  context.globalAlpha = 0.42;
  context.lineWidth = 1;
  context.beginPath();
  for (let tick = 0; tick < 4; tick += 1) {
    const angle = (Math.PI * tick) / 2;
    const inner = TOUCH_STICK_RADIUS - 7;
    context.moveTo(stick.startX + Math.cos(angle) * inner, stick.startY + Math.sin(angle) * inner);
    context.lineTo(
      stick.startX + Math.cos(angle) * (TOUCH_STICK_RADIUS + 4),
      stick.startY + Math.sin(angle) * (TOUCH_STICK_RADIUS + 4),
    );
  }
  context.stroke();
}

function drawDeepSpaceGuide(
  dpr: number,
  screenWidth: number,
  screenHeight: number,
  now: number,
): void {
  const self = snapshot?.ships.find((ship) => ship.id === snapshot?.selfId);
  if (!self?.alive) return;
  const x = predictedSelf?.x ?? self.x;
  const y = predictedSelf?.y ?? self.y;
  const state = deepSpaceState(x, y);
  if (!state.active) return;

  const angle = Math.atan2(state.targetY - y, state.targetX - x);
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  const radius = Math.min(screenWidth, screenHeight) * (screenWidth < 760 ? 0.28 : 0.34);
  const arrowX = clamp(screenWidth / 2 + directionX * radius, 54, screenWidth - 54);
  const arrowY = clamp(screenHeight / 2 + directionY * radius, 88, screenHeight - 58);
  const pulse = reducedMotion.matches ? 1 : 0.9 + Math.sin(now * 0.006) * 0.1;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.save();
  context.translate(arrowX, arrowY);
  context.rotate(angle);
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";
  const arrow = new Path2D();
  arrow.moveTo(-24, -14);
  arrow.lineTo(3, 0);
  arrow.lineTo(-24, 14);
  arrow.moveTo(-1, 0);
  arrow.lineTo(-38, 0);
  context.strokeStyle = "#efff4d";
  context.globalAlpha = 0.18 * pulse;
  context.lineWidth = 7;
  context.stroke(arrow);
  context.globalAlpha = 0.95 * pulse;
  context.lineWidth = 1.5;
  context.stroke(arrow);
  context.restore();
}

function deepSpaceState(
  x: number,
  y: number,
): { active: boolean; targetX: number; targetY: number } {
  const left = -DEEP_SPACE_MARGIN;
  const right = WORLD_WIDTH + DEEP_SPACE_MARGIN;
  const top = -DEEP_SPACE_MARGIN;
  const bottom = WORLD_HEIGHT + DEEP_SPACE_MARGIN;
  const active = x < left || x > right || y < top || y > bottom;
  return {
    active,
    targetX: clamp(x, 0, WORLD_WIDTH),
    targetY: clamp(y, 0, WORLD_HEIGHT),
  };
}

function runDeepSpaceSelfTest(): void {
  const center = deepSpaceState(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
  const farLeft = deepSpaceState(-DEEP_SPACE_MARGIN - 1, WORLD_HEIGHT / 2);
  const farBottom = deepSpaceState(WORLD_WIDTH / 2, WORLD_HEIGHT + DEEP_SPACE_MARGIN + 1);
  if (center.active || !farLeft.active || !farBottom.active) {
    throw new Error("Deep-space warning boundary regression");
  }
  if (farLeft.targetX !== 0 || farBottom.targetY !== WORLD_HEIGHT) {
    throw new Error("Deep-space return direction regression");
  }
}

function mothershipThreatState(x: number, y: number, base: MothershipView | undefined): boolean {
  if (!base) return false;
  for (const mount of MOTHERSHIP_TURRET_MOUNTS) {
    const turretX = base.x + mount.xFactor * base.width + mount.normalX * 12;
    const turretY = base.y + mount.yFactor * base.height + mount.normalY * 12;
    const dx = x - turretX;
    const dy = y - turretY;
    const insideArc = dx * mount.normalX + dy * mount.normalY > 4;
    if (insideArc && Math.hypot(dx, dy) < MOTHERSHIP_PLAYER_TARGET_RANGE) return true;
  }
  return false;
}

function runMothershipThreatSelfTest(): void {
  const base: MothershipView = {
    team: "magenta",
    x: 2000,
    y: 2000,
    width: 420,
    height: 1400,
    hp: 3000,
    maxHp: 3000,
  };
  const leftMount = MOTHERSHIP_TURRET_MOUNTS[0];
  const turretX = base.x + leftMount.xFactor * base.width + leftMount.normalX * 12;
  const turretY = base.y + leftMount.yFactor * base.height + leftMount.normalY * 12;
  if (
    !mothershipThreatState(turretX - MOTHERSHIP_PLAYER_TARGET_RANGE + 1, turretY, base) ||
    mothershipThreatState(turretX - MOTHERSHIP_PLAYER_TARGET_RANGE - 1, turretY, base) ||
    mothershipThreatState(turretX + 100, turretY, base)
  ) {
    throw new Error("Mothership threat warning boundary regression");
  }
}

function rookieProtectionState(ship: ShipView, base: MothershipView | undefined): boolean {
  if (!base || base.team !== ship.team) return false;
  return (
    shipTransformTier(ship.shipClass) <= ROOKIE_PROTECTED_MAX_TIER &&
    ship.x >= base.x - base.width / 2 - ROOKIE_SECTOR_MARGIN &&
    ship.x <= base.x + base.width / 2 + ROOKIE_SECTOR_MARGIN &&
    ship.y >= base.y - base.height / 2 - ROOKIE_SECTOR_MARGIN &&
    ship.y <= base.y + base.height / 2 + ROOKIE_SECTOR_MARGIN
  );
}

function updateRookieSectorHint(active: boolean, now: number): boolean {
  if (active && !rookieSectorHintShown) {
    rookieSectorHintShown = true;
    rookieSectorHintUntil = now + ROOKIE_SECTOR_HINT_MS;
  } else if (!active) {
    rookieSectorHintUntil = 0;
  }
  return active && now < rookieSectorHintUntil;
}

function runRookieSectorSelfTest(): void {
  const base: MothershipView = {
    team: "cyan",
    x: 1000,
    y: 2000,
    width: 420,
    height: 1400,
    hp: 3000,
    maxHp: 3000,
  };
  const rookie = {
    team: "cyan",
    x: base.x + base.width / 2 + ROOKIE_SECTOR_MARGIN,
    y: base.y,
    shipClass: "needle",
  } as ShipView;
  if (
    !rookieProtectionState(rookie, base) ||
    rookieProtectionState({ ...rookie, x: rookie.x + 1 }, base) ||
    rookieProtectionState({ ...rookie, shipClass: "lance" }, base) ||
    rookieProtectionState({ ...rookie, team: "magenta" }, base)
  ) {
    throw new Error("Rookie sector boundary regression");
  }

  const previousHintShown = rookieSectorHintShown;
  const previousHintUntil = rookieSectorHintUntil;
  rookieSectorHintShown = false;
  rookieSectorHintUntil = 0;
  const firstEntryShows = updateRookieSectorHint(true, 100);
  const exitHides = !updateRookieSectorHint(false, 200);
  const secondEntryStaysHidden = !updateRookieSectorHint(true, 300);
  rookieSectorHintShown = previousHintShown;
  rookieSectorHintUntil = previousHintUntil;
  if (!firstEntryShows || !exitHides || !secondEntryStaysHidden) {
    throw new Error("Rookie sector one-shot hint regression");
  }
}

function projectedPersonalCargoValue(cargo: number): number {
  if (cargo <= 0) return 0;
  return cargo - Math.max(1, Math.floor(cargo * 0.25));
}

function hasAffordableUpgradeAfterDeposit(ship: ShipView): boolean {
  const projectedBank = ship.bank + projectedPersonalCargoValue(ship.cargo);
  const projectedResearch = Math.min(65_535, ship.research + ship.cargo);
  const transformReady = (CLASS_UPGRADE_OPTIONS[ship.shipClass] ?? []).some((target) => {
    const cost = classUpgradeCost(ship.shipClass, target);
    const research = classResearchRequirement(ship.shipClass, target);
    return (
      cost !== undefined &&
      research !== undefined &&
      projectedBank >= cost &&
      projectedResearch >= research
    );
  });
  if (transformReady) return true;
  return (["weapon", "engine", "hull", "mining"] as const).some(
    (stat) => ship.stats[stat] < MAX_STAT_LEVEL && projectedBank >= statCost(ship.stats[stat]),
  );
}

function runUpgradeReadinessSelfTest(): void {
  const starter = {
    shipClass: "scout",
    bank: 0,
    research: 0,
    cargo: 72,
    stats: { weapon: 0, engine: 0, hull: 0, mining: 0 },
  } as ShipView;
  const maxStats = { weapon: 7, engine: 7, hull: 7, mining: 7 };
  if (
    hasAffordableUpgradeAfterDeposit(starter) ||
    !hasAffordableUpgradeAfterDeposit({ ...starter, cargo: 73 }) ||
    hasAffordableUpgradeAfterDeposit({ ...starter, cargo: 159, stats: maxStats }) ||
    !hasAffordableUpgradeAfterDeposit({ ...starter, cargo: 160, stats: maxStats }) ||
    hasAffordableUpgradeAfterDeposit({
      ...starter,
      shipClass: "deadeye",
      cargo: 500,
      stats: maxStats,
    })
  ) {
    throw new Error("Projected upgrade readiness regression");
  }
}

function runMothershipUpgradeBaySelfTest(): void {
  const base = {
    team: "cyan",
    x: 1000,
    y: 2000,
    width: 420,
    height: 1400,
  } as MothershipView;
  const bay = mothershipUpgradeBay(base);
  if (
    bay.width >= base.width * 0.75 ||
    bay.height >= base.height * 0.25 ||
    bay.left <= base.x - base.width / 2 ||
    bay.top <= base.y - base.height / 2
  ) {
    throw new Error("Mothership upgrade bay footprint regression");
  }
}

function runProgressionSelfTest(): void {
  if (
    classUpgradeCost("scout", "needle") !== 120 ||
    classUpgradeCost("needle", "lance") !== 220 ||
    classUpgradeCost("lance", "railcore") !== 300 ||
    classUpgradeCost("railcore", "deadeye") !== 400 ||
    classResearchRequirement("railcore", "deadeye") !== 1500 ||
    classUpgradeCost("needle", "ram") !== undefined ||
    classUpgradeCost("lance", "fork") !== undefined ||
    previousShipClass("needle") !== "scout" ||
    previousShipClass("deadeye") !== "railcore" ||
    previousShipClass("scout") !== undefined
  ) {
    throw new Error("Progression branch regression");
  }
  for (const [shipClass, weapon] of Object.entries(SHIP_WEAPONS) as [
    ShipClass,
    (typeof SHIP_WEAPONS)[ShipClass],
  ][]) {
    if (weapon.mode === "drone" && shipTransformTier(shipClass) < 4) {
      throw new Error(`Homing drones must remain an apex mechanic: ${shipClass}`);
    }
  }
  const reached = new Set<ShipClass>();
  for (let tier = 1; tier < CAMERA_SCALE_BY_TIER.length; tier += 1) {
    if (CAMERA_SCALE_BY_TIER[tier] >= CAMERA_SCALE_BY_TIER[tier - 1]) {
      throw new Error(`Camera view must expand at transform tier ${tier}`);
    }
  }
  for (const [current, targets] of Object.entries(CLASS_UPGRADE_OPTIONS)) {
    for (const target of targets ?? []) {
      if (SHIP_PHYSICS[target].radius <= SHIP_PHYSICS[current as ShipClass].radius) {
        throw new Error(`Ship scale must grow from ${current} to ${target}`);
      }
    }
  }
  const visit = (shipClass: ShipClass, expectedTier: number): void => {
    if (reached.has(shipClass) || shipTransformTier(shipClass) !== expectedTier) {
      throw new Error(`Progression tier or cycle regression at ${shipClass}`);
    }
    reached.add(shipClass);
    const options = CLASS_UPGRADE_OPTIONS[shipClass] ?? [];
    if ((expectedTier === 4) !== (options.length === 0)) {
      throw new Error(`Progression endpoint regression at ${shipClass}`);
    }
    for (const target of options) visit(target, expectedTier + 1);
  };
  visit("scout", 0);
  if (reached.size !== 29) throw new Error(`Expected 29 reachable frames, got ${reached.size}`);
}

function runBaseBreakEffectSelfTest(): void {
  const effectId = 0xfffffff0;
  const particleCount = particles.length;
  const flashCount = flashes.length;
  const effectOrderCount = effectIdOrder.length;
  const previousShake = shakeStrength;
  spawnImpact({
    type: "effect",
    id: effectId,
    kind: "baseBreak",
    x: WORLD_WIDTH / 2,
    y: WORLD_HEIGHT / 2,
    team: "cyan",
    intensity: 5.5,
  });
  const generatedParticles = particles.length - particleCount;
  const generatedFlashes = flashes.length - flashCount;
  particles.length = particleCount;
  flashes.length = flashCount;
  effectIdOrder.length = effectOrderCount;
  seenEffectIds.delete(effectId);
  shakeStrength = previousShake;
  if (generatedParticles < 24 || generatedFlashes !== 3) {
    throw new Error("Mothership destruction effect regression");
  }
}

function applyDockPanelState(): void {
  const collapsed = dockPanelCollapsed;
  dockPanel.classList.toggle("collapsed", collapsed);
  document.body.classList.add("dock-menu-collapsible");
  document.body.classList.toggle("dock-menu-mobile", mobileDockMedia.matches);
  document.body.classList.toggle("dock-menu-expanded", !collapsed);
  dockCollapse.hidden = false;
  dockCollapse.textContent = collapsed ? "UPGRADES" : "CLOSE";
  dockCollapse.setAttribute("aria-expanded", String(!collapsed));
  dockCollapse.setAttribute(
    "aria-label",
    collapsed ? "Expand mothership upgrades" : "Close mothership upgrades",
  );
  dockContent.inert = collapsed;
  dockContent.setAttribute("aria-hidden", String(collapsed));
}

function renderTransformOptions(shipClass: ShipClass): void {
  if (renderedTransformClass === shipClass) return;
  renderedTransformClass = shipClass;
  transformRow.replaceChildren();
  const options = CLASS_UPGRADE_OPTIONS[shipClass] ?? [];
  transformRow.hidden = options.length === 0;
  transformRow.classList.toggle("one-option", options.length === 1);
  transformRow.classList.toggle("two-options", options.length === 2);
  for (const target of options) {
    const cost = classUpgradeCost(shipClass, target);
    const research = classResearchRequirement(shipClass, target);
    const info = SHIP_CLASS_INFO[target];
    const button = document.createElement("button");
    button.dataset.action = "upgradeClass";
    button.dataset.value = target;
    const title = document.createElement("b");
    title.textContent = target.toUpperCase();
    const description = document.createElement("span");
    description.textContent = info.description;
    const requirement = document.createElement("em");
    requirement.textContent = `${cost ?? "—"} SALVAGE · R${research ?? "—"}`;
    button.append(title, description, requirement);
    transformRow.append(button);
  }
}

function updateHud(message: SnapshotMessage): void {
  const self = message.ships.find((ship) => ship.id === message.selfId);
  const cyan = message.motherships.find((base) => base.team === "cyan");
  const magenta = message.motherships.find((base) => base.team === "magenta");
  updateBaseHud("cyan", cyan);
  updateBaseHud("magenta", magenta);

  if (!self) {
    return;
  }
  required<HTMLElement>("#pilot-class").textContent = self.alive
    ? self.shipClass.toUpperCase()
    : `RECONSTRUCT ${self.respawnIn.toFixed(1)}`;
  required<HTMLElement>("#pilot-class").style.color = TEAM_COLORS[self.team];
  const pilotAbility = required<HTMLElement>("#pilot-ability");
  const apexFrame = shipTransformTier(self.shipClass) === 4;
  const magnetRange = miningMagnetRadius(self.stats.mining);
  const ramImpact = RAM_IMPACT_PROFILES[self.shipClass];
  const apexAbility = ramImpact?.arcRadius
    ? `APEX RAM ARC ${ramImpact.arcRadius * 2} · MULTI-HIT`
    : "APEX SIEGE SCREEN · TURRET RESIST";
  pilotAbility.textContent = apexFrame
    ? magnetRange > 0
      ? `${apexAbility} · MAGNET ${magnetRange} · PULL ${self.stats.mining}/${MAX_STAT_LEVEL}`
      : apexAbility
    : magnetRange > 0
      ? `SALVAGE MAGNET · ${magnetRange} RANGE · PULL ${self.stats.mining}/${MAX_STAT_LEVEL}`
      : "";
  pilotAbility.classList.toggle("visible", apexFrame || magnetRange > 0);
  required<HTMLElement>("#pilot-health").textContent =
    `${Math.max(0, Math.ceil(self.hp))} / ${Math.ceil(self.maxHp)}`;
  required<HTMLElement>("#pilot-cargo").textContent = String(self.cargo);
  required<HTMLElement>("#pilot-bank").textContent = String(self.bank);
  required<HTMLElement>("#pilot-research").textContent = String(self.research);
  required<HTMLElement>("#team-bank").textContent = String(message.teamBank[self.team]);
  required<HTMLElement>("#transform-tier").textContent = String(shipTransformTier(self.shipClass));
  dockPanel.classList.toggle("visible", self.docked);
  document.body.classList.toggle("is-docked", self.docked);
  const showRespawnTimer = !self.alive && message.winner === null;
  if (!self.alive && localShipWasAlive) {
    resetInputState();
    sendInput();
  }
  localShipWasAlive = self.alive;
  document.body.classList.toggle("is-respawning", showRespawnTimer);
  respawnOverlay.hidden = !showRespawnTimer;
  respawnOverlay.classList.toggle("visible", showRespawnTimer);
  respawnOverlay.setAttribute("aria-hidden", String(!showRespawnTimer));
  respawnOverlay.style.color = TEAM_COLORS[self.team];
  respawnCountdown.textContent = Math.max(0, self.respawnIn).toFixed(1);
  const hudNow = performance.now();
  const deepSpace = deepSpaceState(self.x, self.y);
  const showDeepSpaceWarning = self.alive && deepSpace.active;
  deepSpaceWarning.hidden = !showDeepSpaceWarning;
  deepSpaceWarning.classList.toggle("visible", showDeepSpaceWarning);
  deepSpaceWarning.setAttribute("aria-hidden", String(!showDeepSpaceWarning));
  const enemyBase = message.motherships.find((base) => base.team !== self.team);
  const homeBase = message.motherships.find((base) => base.team === self.team);
  const rookieSectorActive = self.alive && !self.docked && rookieProtectionState(self, homeBase);
  const showRookieSectorWarning = updateRookieSectorHint(rookieSectorActive, hudNow);
  rookieSectorWarning.hidden = !showRookieSectorWarning;
  rookieSectorWarning.classList.toggle("visible", showRookieSectorWarning);
  rookieSectorWarning.setAttribute("aria-hidden", String(!showRookieSectorWarning));
  rookieSectorWarning.style.color = TEAM_COLORS[self.team];
  const showMothershipRangeWarning =
    self.alive && !self.docked && mothershipThreatState(self.x, self.y, enemyBase);
  const threatNow = hudNow;
  if (showMothershipRangeWarning && mothershipThreatStartedAt === 0) {
    mothershipThreatStartedAt = threatNow;
  } else if (!showMothershipRangeWarning) {
    mothershipThreatStartedAt = 0;
  }
  const lockRemaining = Math.max(
    0,
    MOTHERSHIP_LOCK_ON_MS - (threatNow - mothershipThreatStartedAt),
  );
  mothershipRangeCopy.textContent =
    lockRemaining > 0
      ? `LOCK-ON IN ${(lockRemaining / 1000).toFixed(1)} · BREAK RANGE`
      : apexFrame
        ? "APEX SIEGE SCREEN ACTIVE · PRESS OR RETREAT"
        : "LOCKED · EVADE OR USE ASTEROID COVER";
  mothershipRangeWarning.hidden = !showMothershipRangeWarning;
  mothershipRangeWarning.classList.toggle("visible", showMothershipRangeWarning);
  mothershipRangeWarning.classList.toggle(
    "locked",
    showMothershipRangeWarning && lockRemaining === 0,
  );
  mothershipRangeWarning.setAttribute("aria-hidden", String(!showMothershipRangeWarning));
  document.body.classList.toggle(
    "has-center-warning",
    showDeepSpaceWarning || showRookieSectorWarning || showMothershipRangeWarning,
  );
  if (upgradeReadyTipShipId !== self.id) {
    upgradeReadyTipShipId = self.id;
    upgradeReadyTipShown = false;
  }
  const upgradeReadyAfterDeposit = hasAffordableUpgradeAfterDeposit(self);
  if (self.alive && !self.docked && upgradeReadyAfterDeposit && !upgradeReadyTipShown) {
    upgradeReadyTipShown = true;
    showToast(
      {
        type: "event",
        text: "UPGRADE READY · RETURN TO YOUR MOTHERSHIP",
        tone: "good",
      },
      UPGRADE_READY_TIP_MS,
    );
  }
  if (import.meta.env.DEV) {
    const visibleBots = message.ships.filter((ship) => ship.name.startsWith("BOT "));
    const asteroidKindCounts: Record<AsteroidKind, number> = {
      rock: 0,
      iron: 0,
      crystal: 0,
      core: 0,
    };
    for (const asteroid of message.asteroids) asteroidKindCounts[asteroid.kind] += 1;
    required<HTMLOutputElement>("#playtest-state").value = [
      `x=${self.x.toFixed(1)}`,
      `y=${self.y.toFixed(1)}`,
      `docked=${self.docked}`,
      `alive=${self.alive}`,
      `class=${self.shipClass}`,
      `respawn=${self.respawnIn.toFixed(1)}`,
      `cargo=${self.cargo}`,
      `bank=${self.bank}`,
      `research=${self.research}`,
      `mining=${self.stats.mining}`,
      `ships=${message.ships.length}`,
      `bots=${visibleBots.length}`,
      `identities=${playerNames.size}`,
      `bot-cargo=${visibleBots.reduce((total, bot) => total + bot.cargo, 0)}`,
      `bot-bank=${visibleBots.reduce((total, bot) => total + bot.bank, 0)}`,
      `bot-tier=${visibleBots.reduce((tier, bot) => Math.max(tier, shipTransformTier(bot.shipClass)), 0)}`,
      `asteroids=${message.asteroids.length}`,
      `asteroid-kinds=${Object.entries(asteroidKindCounts)
        .map(([kind, count]) => `${kind}:${count}`)
        .join(",")}`,
      `projectiles=${message.projectiles.length}`,
      `salvage=${visibleSalvage.length}`,
      `deep-space=${showDeepSpaceWarning}`,
      `mothership-range=${showMothershipRangeWarning}`,
      `rookie-protected=${rookieSectorActive}`,
      `rookie-sector=${showRookieSectorWarning}`,
      `upgrade-ready=${upgradeReadyAfterDeposit}`,
      `upgrade-tip-shown=${upgradeReadyTipShown}`,
      `touch=${document.body.classList.contains("touch-controls")}`,
      `touch-emulation=${touchMouseEmulation}`,
      `viewport=${viewportWidth()}x${viewportHeight()}`,
    ].join(" ");
  }

  renderTransformOptions(self.shipClass);
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    'button[data-action="upgradeClass"]',
  )) {
    const target = button.dataset.value as ShipClass;
    const cost = classUpgradeCost(self.shipClass, target);
    const research = classResearchRequirement(self.shipClass, target);
    button.disabled =
      cost === undefined || research === undefined || self.bank < cost || self.research < research;
  }
  for (const stat of ["weapon", "engine", "hull", "mining"] as const) {
    const level = self.stats[stat];
    const cost = statCost(level);
    const levelNode = document.querySelector<HTMLElement>(`[data-level="${stat}"]`);
    const costNode = document.querySelector<HTMLElement>(`[data-cost="${stat}"]`);
    const button = document.querySelector<HTMLButtonElement>(`button[data-value="${stat}"]`);
    if (levelNode)
      levelNode.textContent = `${"●".repeat(level)}${"○".repeat(MAX_STAT_LEVEL - level)}`;
    if (costNode) costNode.textContent = level >= MAX_STAT_LEVEL ? "MAX" : String(cost);
    if (button) button.disabled = level >= MAX_STAT_LEVEL || self.bank < cost;
  }

  const winnerName = message.winner?.toUpperCase();
  winnerPanel.classList.toggle("visible", message.winner !== null);
  const winnerTitle = winnerPanel.querySelector("b");
  const winnerCopy = winnerPanel.querySelector("span");
  if (winnerTitle && message.winner) {
    winnerTitle.textContent = `${winnerName} VICTORY`;
    (winnerTitle as HTMLElement).style.color = TEAM_COLORS[message.winner];
  }
  if (winnerCopy)
    winnerCopy.textContent = message.winner
      ? `NEW EXTRACTION CYCLE IN ${message.resetIn.toFixed(1)}`
      : "";
}

function updateBaseHud(team: Team, base: MothershipView | undefined): void {
  if (!base) {
    return;
  }
  const percent = Math.round(clamp(base.hp / base.maxHp, 0, 1) * 100);
  required<HTMLElement>(`#${team}-health`).style.width = `${percent}%`;
  required<HTMLElement>(`#${team}-value`).textContent = `${percent}%`;
  const meter = required<HTMLElement>(`#${team}-meter`);
  meter.setAttribute("aria-valuenow", String(percent));
  meter.setAttribute("aria-valuetext", `${percent}% health`);
}

function showToast(message: EventMessage, durationMs = 2_200): void {
  const showInDock =
    document.body.classList.contains("is-docked") &&
    document.body.classList.contains("dock-menu-expanded");
  const target = showInDock ? dockFeedback : toast;
  const other = showInDock ? toast : dockFeedback;
  other.textContent = "";
  other.className = "";
  target.textContent = message.text;
  target.className = `show ${message.tone}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    target.className = "";
    target.textContent = "";
  }, durationMs);
}

function resize(): void {
  const bounds = canvas.getBoundingClientRect();
  const fallbackWidth = window.visualViewport?.width ?? window.innerWidth;
  const fallbackHeight = window.visualViewport?.height ?? window.innerHeight;
  canvas.width = Math.max(1, Math.floor(bounds.width || fallbackWidth));
  canvas.height = Math.max(1, Math.floor(bounds.height || fallbackHeight));
  if (touchAim) updateTouchAim();
}

function viewportWidth(): number {
  return Math.max(1, canvas.width);
}

function viewportHeight(): number {
  return Math.max(1, canvas.height);
}

function getView(): { scale: number; offsetX: number; offsetY: number } {
  const width = viewportWidth();
  const height = viewportHeight();
  const scale = clamp(height / 1000, 0.5, 1.35) * cameraTierScale;
  return {
    scale,
    offsetX: width / 2 - cameraX * scale,
    offsetY: height / 2 - cameraY * scale,
  };
}

function screenToWorld(x: number, y: number): { x: number; y: number } {
  const view = getView();
  return {
    x: (x - view.offsetX) / view.scale,
    y: (y - view.offsetY) / view.scale,
  };
}

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0xffffffff;
  };
}

function normalizeAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

function requiredContext(target: HTMLCanvasElement): CanvasRenderingContext2D {
  const value = target.getContext("2d");
  if (!value) throw new Error("Canvas 2D unavailable");
  return value;
}
