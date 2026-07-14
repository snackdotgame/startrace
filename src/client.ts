import { client } from "snack:client";
import {
  CLASS_UPGRADE_OPTIONS,
  MAX_STAT_LEVEL,
  MOTHERSHIP_LOCK_ON_MS,
  MOTHERSHIP_PLAYER_TARGET_RANGE,
  MOTHERSHIP_TURRET_MOUNTS,
  SHIP_CLASS_INFO,
  SHIP_PHYSICS,
  SHIP_WEAPONS,
  STAT_BONUSES,
  TEAM_COLORS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  classResearchRequirement,
  classUpgradeCost,
  previousShipClass,
  shipTransformTier,
  statCost,
  type ActionMessage,
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

root.innerHTML = `
  <canvas id="game" aria-label="Startrace game field"></canvas>
  <div id="hud">
    <div id="brand">STARTRACE <span>VECTOR EXTRACTION</span></div>
    <div id="connection">CONNECTING TO MOTHERSHIP</div>
    <button id="sound-toggle" type="button">SOUND · ARMED</button>
    <div id="base-status">
      <div class="base cyan"><b>CYAN CORE</b><div class="meter"><i id="cyan-health"></i></div><em id="cyan-value">—</em></div>
      <div class="base magenta"><b>MAGENTA CORE</b><div class="meter"><i id="magenta-health"></i></div><em id="magenta-value">—</em></div>
    </div>
    <section id="pilot-panel">
      <strong id="pilot-class">SCOUT</strong>
      <small id="pilot-ability"></small>
      <div><span>INTEGRITY</span><b id="pilot-health">—</b></div>
      <div><span>CARGO</span><b id="pilot-cargo">0</b></div>
      <div><span>BANK</span><b id="pilot-bank">0</b></div>
      <div><span>RESEARCH</span><b id="pilot-research">0</b></div>
      <div><span>TEAM RESERVE</span><b id="team-bank">0</b></div>
    </section>
    <div id="toast"></div>
    <div id="deep-space-warning" role="status" aria-live="polite" aria-hidden="true" hidden>
      <b>DEEP SPACE</b><span>RETURN TO THE COMBAT ZONE</span>
    </div>
    <div id="mothership-range-warning" role="status" aria-live="polite" aria-hidden="true" hidden>
      <b>ENEMY MOTHERSHIP RANGE</b><span id="mothership-range-copy">DEFENSE CANNONS TRACKING</span>
    </div>
    <section id="dock-panel">
      <div class="dock-title"><b>MOTHERSHIP LINK</b><span>FRAME <i id="transform-tier">0</i> / 4 · RESEARCH UNLOCKS FRAMES</span></div>
      <div id="transform-row" class="upgrade-row class-row"></div>
      <div class="upgrade-row stat-row">
        <button data-action="upgradeStat" data-value="weapon"><b>WEAPON</b><span data-level="weapon">${"○".repeat(MAX_STAT_LEVEL)}</span><em data-cost="weapon">${statCost(0)}</em></button>
        <button data-action="upgradeStat" data-value="engine"><b>ENGINE</b><span data-level="engine">${"○".repeat(MAX_STAT_LEVEL)}</span><em data-cost="engine">${statCost(0)}</em></button>
        <button data-action="upgradeStat" data-value="hull"><b>HULL</b><span data-level="hull">${"○".repeat(MAX_STAT_LEVEL)}</span><em data-cost="hull">${statCost(0)}</em></button>
        <button data-action="upgradeStat" data-value="mining"><b>MINING</b><span data-level="mining">${"○".repeat(MAX_STAT_LEVEL)}</span><em data-cost="mining">${statCost(0)}</em></button>
      </div>
      <div class="repair-row">
        <button data-action="repair"><b>REPAIR SHIP</b><span>RESTORE 32 INTEGRITY</span></button>
        <button data-action="repairMothership"><b>REPAIR MOTHERSHIP</b><span>15 TEAM RESERVE</span></button>
      </div>
    </section>
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
  html, body, #app { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #010207; }
  body { color: #e9fffc; user-select: none; }
  #game { display: block; position: absolute; z-index: 0; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
  #app::after { content: ""; position: absolute; z-index: 1; inset: 0; pointer-events: none; background: radial-gradient(circle at 50% 48%, transparent 48%, #01020755 100%), repeating-linear-gradient(0deg, #0000 0 3px, #aaffff09 3px 4px); }
  #hud { position: fixed; z-index: 2; inset: 0; pointer-events: none; text-transform: uppercase; letter-spacing: .08em; }
  #brand { position: absolute; top: 20px; left: 52px; font-size: 18px; font-weight: 800; color: #fff; text-shadow: 0 0 12px #63fff3; }
  #brand span { display: block; margin-top: 4px; font-size: 10px; font-weight: 600; color: #63fff3; letter-spacing: .18em; }
  #connection { position: absolute; top: 23px; right: 22px; font-size: 11px; color: #b1c3d5; }
  #sound-toggle { pointer-events: auto; position: absolute; right: 22px; top: 50px; min-height: 0; width: auto; padding: 7px 10px; color: #a9bdcc; border: 1px solid #345069; background: #030812e8; font-size: 9px; letter-spacing: .08em; }
  #base-status { position: absolute; top: 18px; left: 50%; width: min(620px, 46vw); transform: translateX(-50%); display: flex; gap: 22px; }
  .base { flex: 1; display: grid; grid-template-columns: 1fr auto; gap: 6px 10px; font-size: 10px; }
  .base b { color: #fff; }
  .base em { grid-column: 2; grid-row: 1 / span 2; align-self: center; font-size: 13px; font-style: normal; }
  .meter { height: 5px; background: #172032; overflow: hidden; }
  .meter i { display: block; width: 100%; height: 100%; transition: width .18s linear; box-shadow: 0 0 9px currentColor; }
  .cyan { color: #63fff3; } .cyan .meter i { background: #63fff3; }
  .magenta { color: #ff5eaa; } .magenta .meter i { background: #ff5eaa; }
  #pilot-panel { position: absolute; left: 22px; top: 82px; width: 210px; padding: 13px 14px; border-left: 1px solid #63fff3; background: linear-gradient(90deg, #09121bed, transparent); font-size: 11px; }
  #pilot-panel strong { display: block; margin-bottom: 10px; color: #63fff3; font-size: 16px; text-shadow: 0 0 8px currentColor; }
  #pilot-ability { display: none; margin: -5px 0 9px; color: #fff; font-size: 8px; line-height: 1.4; text-shadow: 0 0 8px currentColor; }
  #pilot-ability.visible { display: block; }
  #pilot-panel div { display: flex; justify-content: space-between; padding: 4px 0; color: #a9bdcc; }
  #pilot-panel b { color: #fff; }
  #toast { position: absolute; top: 104px; left: 50%; min-width: 300px; padding: 10px 18px; transform: translate(-50%, -8px); opacity: 0; text-align: center; font-size: 12px; background: #061017ed; border: 1px solid #63fff3; color: #63fff3; transition: opacity .16s, transform .16s; }
  #toast.show { opacity: 1; transform: translate(-50%, 0); }
  #toast.bad { border-color: #ff5eaa; color: #ff5eaa; }
  #toast.good { border-color: #ecff45; color: #ecff45; }
  #deep-space-warning { position: absolute; top: 62px; left: 50%; min-width: 280px; padding: 8px 18px; transform: translate(-50%, -8px); opacity: 0; text-align: center; border: 1px solid #efff4d; background: #080b03e6; box-shadow: 0 0 22px #efff4d22, inset 0 0 16px #efff4d0d; color: #efff4d; transition: opacity .18s, transform .18s; }
  #deep-space-warning.visible { opacity: 1; transform: translate(-50%, 0); }
  #deep-space-warning b { display: block; font-size: 14px; text-shadow: 0 0 9px currentColor; }
  #deep-space-warning span { display: block; margin-top: 4px; color: #dce6a3; font-size: 9px; letter-spacing: .12em; }
  #mothership-range-warning { position: absolute; top: 62px; left: 50%; min-width: 330px; padding: 8px 18px; transform: translate(-50%, -8px); opacity: 0; text-align: center; border: 1px solid #ff5eaa; background: #10030bed; box-shadow: 0 0 22px #ff5eaa2b, inset 0 0 16px #ff5eaa12; color: #ff5eaa; transition: opacity .18s, transform .18s; }
  #mothership-range-warning.visible { opacity: 1; transform: translate(-50%, 0); }
  #mothership-range-warning.locked { border-color: #fff; box-shadow: 0 0 30px #ff5eaa55, inset 0 0 22px #ff5eaa1f; }
  #mothership-range-warning b { display: block; font-size: 14px; text-shadow: 0 0 9px currentColor; }
  #mothership-range-warning span { display: block; margin-top: 4px; color: #ffc0da; font-size: 9px; letter-spacing: .12em; }
  #dock-panel { pointer-events: auto; position: absolute; right: 18px; top: 76px; width: min(540px, calc(100vw - 36px)); padding: 16px; border: 1px solid #63fff3; background: #020711f2; box-shadow: 0 0 28px #16fff020, inset 0 0 22px #16fff00d; opacity: 0; transform: translateX(20px); transition: opacity .18s, transform .18s; pointer-events: none; }
  #dock-panel.visible { opacity: 1; transform: translateX(0); pointer-events: auto; }
  .dock-title { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin-bottom: 13px; color: #63fff3; }
  .dock-title b { flex: none; font-size: 16px; text-shadow: 0 0 10px currentColor; }
  .dock-title span { font-size: 9px; line-height: 1.4; color: #a9bdcc; text-align: right; }
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
  #prompt { position: absolute; bottom: 17px; left: 50%; transform: translateX(-50%); color: #9cafc0; font-size: 10px; white-space: nowrap; }
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
  @media (max-width: 760px) {
    #brand { top: 12px; left: 48px; font-size: 15px; }
    #brand span { font-size: 8px; }
    #connection { display: none; }
    #sound-toggle { top: 52px; right: 10px; }
    #base-status { top: 12px; left: auto; right: 10px; width: 58vw; transform: none; gap: 8px; }
    .base { font-size: 9px; } .base em { display: none; }
    #pilot-panel { top: 62px; left: 10px; width: 165px; font-size: 9px; }
    #pilot-panel strong { font-size: 13px; }
    #deep-space-warning { top: 112px; min-width: 230px; padding: 7px 12px; }
    #mothership-range-warning { top: 112px; min-width: 290px; padding: 7px 12px; }
    #dock-panel { top: auto; bottom: 42px; max-height: 78vh; overflow: auto; }
    .upgrade-row { grid-template-columns: repeat(2, 1fr); }
    .repair-row { grid-template-columns: 1fr; }
    #prompt { bottom: 10px; width: calc(100vw - 20px); font-size: 9px; line-height: 1.4; text-align: center; white-space: normal; }
  }
  @media (max-width: 520px) {
    .dock-title { align-items: flex-start; flex-direction: column; gap: 6px; }
    .dock-title span { text-align: left; }
  }
  @media (prefers-reduced-motion: reduce) {
    #toast, #deep-space-warning, #mothership-range-warning, #dock-panel, #respawn-overlay, #winner, .meter i { transition: none; }
  }
`;
document.head.append(style);

const canvas = required<HTMLCanvasElement>("#game");
const context = requiredContext(canvas);
let inputSurface: HTMLCanvasElement = canvas;

const connectionLabel = required<HTMLElement>("#connection");
const dockPanel = required<HTMLElement>("#dock-panel");
const transformRow = required<HTMLElement>("#transform-row");
const toast = required<HTMLElement>("#toast");
const deepSpaceWarning = required<HTMLElement>("#deep-space-warning");
const mothershipRangeWarning = required<HTMLElement>("#mothership-range-warning");
const mothershipRangeCopy = required<HTMLElement>("#mothership-range-copy");
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
const asteroidPaths = new Map<number, { seed: number; radius: number; path: Path2D }>();
const shipPaths = new Map<ShipClass, Path2D>();
const mothershipPaths = new Map<Team, Path2D>();
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
let touchMove:
  | { id: number; startX: number; startY: number; currentX: number; currentY: number }
  | undefined;
let touchAimId: number | undefined;

interface PredictedSelf {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
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
  runProgressionSelfTest();
}
window.addEventListener("resize", resize);
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
window.addEventListener("blur", resetInputState);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    resetInputState();
    sendInput();
  }
  predictionAccumulator = 0;
  lastFrameAt = performance.now();
});
bindInputSurface(canvas);
soundToggle.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundToggle.textContent = soundEnabled ? "SOUND · ON" : "SOUND · OFF";
  if (soundEnabled) {
    unlockAudio();
  } else {
    void audioContext?.suspend();
  }
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
          visibleSalvage = message.salvage;
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
    moveX += clamp((touchMove.currentX - touchMove.startX) / 65, -1, 1);
    moveY += clamp((touchMove.currentY - touchMove.startY) / 65, -1, 1);
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
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
    event.preventDefault();
  }
  keys.add(event.code);
  if (event.code === "Space") sendInput();
  if (event.repeat) {
    return;
  }
  if (event.code === "KeyR") sendAction("repair");
  const optionIndex = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(event.code);
  if (optionIndex >= 0 || event.code === "KeyQ" || event.code === "KeyE") {
    const self = snapshot?.ships.find((ship) => ship.id === snapshot?.selfId);
    const options = self ? CLASS_UPGRADE_OPTIONS[self.shipClass] : undefined;
    const index = optionIndex >= 0 ? optionIndex : event.code === "KeyQ" ? 0 : 1;
    const target = options?.[index];
    if (target) sendAction("upgradeClass", target);
  }
}

function onKeyUp(event: KeyboardEvent): void {
  keys.delete(event.code);
  if (event.code === "Space") sendInput();
}

function onPointerDown(event: PointerEvent): void {
  unlockAudio();
  inputSurface.setPointerCapture(event.pointerId);
  aimScreenX = event.clientX;
  aimScreenY = event.clientY;
  if (event.pointerType === "touch" && event.clientX < window.innerWidth * 0.45) {
    touchMove = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
    };
  } else {
    pointerFire = true;
    if (event.pointerType === "touch") touchAimId = event.pointerId;
    sendInput();
  }
}

function onPointerMove(event: PointerEvent): void {
  if (touchMove?.id === event.pointerId) {
    touchMove.currentX = event.clientX;
    touchMove.currentY = event.clientY;
    return;
  }
  if (event.pointerType !== "touch" || touchAimId === event.pointerId) {
    aimScreenX = event.clientX;
    aimScreenY = event.clientY;
  }
}

function onPointerUp(event: PointerEvent): void {
  if (inputSurface.hasPointerCapture(event.pointerId)) {
    inputSurface.releasePointerCapture(event.pointerId);
  }
  if (touchMove?.id === event.pointerId) touchMove = undefined;
  if (event.pointerType !== "touch" || touchAimId === event.pointerId) {
    pointerFire = false;
    touchAimId = undefined;
    sendInput();
  }
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
  context.fillStyle = "#010207";
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
  drawStars();

  if (snapshot) {
    for (const asteroid of snapshot.asteroids) {
      if (!isWorldVisible(asteroid.x, asteroid.y, asteroid.radius + 30)) continue;
      frameVisibleEntities += 1;
      drawAsteroid(asteroid);
    }
    for (const item of visibleSalvage) {
      if (!isWorldVisible(item.x, item.y, 24)) continue;
      frameVisibleEntities += 1;
      drawSalvage(item.x, item.y, item.value, item.team, now);
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
  touchAimId = undefined;
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

function drawStars(): void {
  context.fillStyle = "#b9d8e0";
  const cellSize = 240;
  const halfWidth = window.innerWidth / (renderScale * 2);
  const halfHeight = window.innerHeight / (renderScale * 2);
  const firstColumn = Math.floor((cameraX - halfWidth) / cellSize) - 1;
  const lastColumn = Math.floor((cameraX + halfWidth) / cellSize) + 1;
  const firstRow = Math.floor((cameraY - halfHeight) / cellSize) - 1;
  const lastRow = Math.floor((cameraY + halfHeight) / cellSize) + 1;
  for (let column = firstColumn; column <= lastColumn; column += 1) {
    for (let row = firstRow; row <= lastRow; row += 1) {
      const random = seeded(((column * 73_856_093) ^ (row * 19_349_663)) >>> 0);
      for (let index = 0; index < 2; index += 1) {
        const x = (column + random()) * cellSize;
        const y = (row + random()) * cellSize;
        context.globalAlpha = 0.16 + random() * 0.5;
        context.fillRect(x, y, 1.3 / renderScale, 1.3 / renderScale);
      }
    }
  }
  context.globalAlpha = 1;
}

function drawAsteroid(asteroid: AsteroidView): void {
  let cached = asteroidPaths.get(asteroid.id);
  if (!cached || cached.seed !== asteroid.seed || cached.radius !== asteroid.radius) {
    const path = new Path2D();
    const random = seeded(asteroid.seed);
    for (let index = 0; index < 9; index += 1) {
      const angle = (Math.PI * 2 * index) / 9;
      const radius = asteroid.radius * (0.78 + random() * 0.26);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (index === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
    cached = { seed: asteroid.seed, radius: asteroid.radius, path };
    asteroidPaths.set(asteroid.id, cached);
  }
  const position = extrapolatedAsteroidPosition(asteroid);
  const integrity = asteroid.hp / asteroid.maxHp;
  context.save();
  context.translate(position.x, position.y);
  glowStroke(cached.path, integrity < 0.35 ? "#ff9f43" : "#dfff43", 1.15, 0.65 + integrity * 0.35);
  glowDot(0, 0, 2.4 + asteroid.radius * 0.035, "#f4ff52");
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
  const color = TEAM_COLORS[base.team];
  const alpha = 0.72 + (base.hp / base.maxHp) * 0.28;
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

  for (const offset of [-base.width * 0.28, 0, base.width * 0.28]) {
    const path = new Path2D();
    path.moveTo(base.x + offset, base.y + base.height / 2 + 8);
    path.lineTo(
      base.x + offset,
      base.y + base.height / 2 + 38 + Math.sin(now * 0.012 + offset) * 6,
    );
    glowStroke(path, color, 1.35, 0.9);
  }
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
  const path = shipPath(ship.shipClass);
  glowStroke(path, color, ship.id === snapshot?.selfId ? 1.75 : 1.3, ship.dashing ? 1 : 0.92);
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

function glowStroke(path: Path2D, color: string, width: number, alpha: number): void {
  frameGlowCalls += 1;
  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = color;
  context.globalAlpha = alpha * 0.2;
  context.lineWidth = 5.5 / renderScale;
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
  const halfWidth = window.innerWidth / (renderScale * 2) + radius;
  const halfHeight = window.innerHeight / (renderScale * 2) + radius;
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
  const breaking = message.kind === "asteroidBreak" || message.kind === "shipBreak";
  const color =
    pickup || message.kind.startsWith("asteroid")
      ? "#efff4d"
      : message.team
        ? TEAM_COLORS[message.team]
        : "#ffffff";
  const motionScale = reducedMotion.matches ? 0.45 : 1;
  const sparkCount = Math.round(
    (pickup ? 5 + message.intensity * 4 : 7 + message.intensity * 9) * motionScale,
  );
  for (let index = 0; index < sparkCount; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed =
      (pickup ? 45 + Math.random() * 105 : 90 + Math.random() * 280) *
      (0.6 + message.intensity * 0.35);
    const fragment = breaking && index % 3 === 0;
    const life = fragment ? 0.55 + Math.random() * 0.5 : 0.18 + Math.random() * 0.34;
    particles.push({
      x: message.x + (Math.random() - 0.5) * 5,
      y: message.y + (Math.random() - 0.5) * 5,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life,
      maxLife: life,
      size: fragment ? 3 + Math.random() * 4 : 1 + Math.random() * 1.8,
      rotation: angle,
      spin: fragment ? (Math.random() - 0.5) * 12 : 0,
      color,
      fragment,
    });
  }
  flashes.push({
    x: message.x,
    y: message.y,
    life: breaking ? 0.32 : pickup ? 0.22 : 0.18,
    maxLife: breaking ? 0.32 : pickup ? 0.22 : 0.18,
    radius: (breaking ? 25 : pickup ? 16 : 12) * Math.max(0.75, message.intensity),
    color,
  });
  const distance = Math.hypot(message.x - cameraX, message.y - cameraY);
  const proximity = clamp(1 - distance / 1500, 0, 1);
  if (!pickup && !reducedMotion.matches) {
    shakeStrength = Math.max(shakeStrength, proximity * message.intensity * (breaking ? 7 : 3.5));
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
    glowDot(flash.x, flash.y, Math.max(1.3, flash.radius * alpha * 0.28), "#ffffff");
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
  const strength = clamp(message.intensity * proximity, 0.08, 1.6);
  const noise = audio.createBufferSource();
  const noiseGain = audio.createGain();
  const filter = audio.createBiquadFilter();
  noise.buffer = impactNoise;
  filter.type = "bandpass";
  filter.frequency.value = message.kind.startsWith("asteroid") ? 1700 : 900;
  filter.Q.value = 0.7;
  noiseGain.gain.setValueAtTime(0.085 * strength, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  noise.connect(filter).connect(noiseGain).connect(audio.destination);
  noise.start(now);
  noise.stop(now + 0.18);

  const thump = audio.createOscillator();
  const thumpGain = audio.createGain();
  thump.type = "sine";
  thump.frequency.setValueAtTime(message.kind.includes("Break") ? 110 : 180, now);
  thump.frequency.exponentialRampToValueAtTime(45, now + 0.13);
  thumpGain.gain.setValueAtTime(0.055 * strength, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
  thump.connect(thumpGain).connect(audio.destination);
  thump.start(now);
  thump.stop(now + 0.15);
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
    context.fillStyle = "#efff4d66";
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
  if (!touchMove) {
    return;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.strokeStyle = "#63fff355";
  context.lineWidth = 1;
  context.beginPath();
  context.arc(touchMove.startX, touchMove.startY, 42, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(touchMove.currentX, touchMove.currentY, 15, 0, Math.PI * 2);
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
  pilotAbility.textContent = apexFrame ? "APEX SIEGE SCREEN · TURRET RESIST" : "";
  pilotAbility.classList.toggle("visible", apexFrame);
  required<HTMLElement>("#pilot-health").textContent =
    `${Math.max(0, Math.ceil(self.hp))} / ${Math.ceil(self.maxHp)}`;
  required<HTMLElement>("#pilot-cargo").textContent = String(self.cargo);
  required<HTMLElement>("#pilot-bank").textContent = String(self.bank);
  required<HTMLElement>("#pilot-research").textContent = String(self.research);
  required<HTMLElement>("#team-bank").textContent = String(message.teamBank[self.team]);
  required<HTMLElement>("#transform-tier").textContent = String(shipTransformTier(self.shipClass));
  dockPanel.classList.toggle("visible", self.docked);
  const showRespawnTimer = !self.alive && message.winner === null;
  respawnOverlay.hidden = !showRespawnTimer;
  respawnOverlay.classList.toggle("visible", showRespawnTimer);
  respawnOverlay.setAttribute("aria-hidden", String(!showRespawnTimer));
  respawnOverlay.style.color = TEAM_COLORS[self.team];
  respawnCountdown.textContent = Math.max(0, self.respawnIn).toFixed(1);
  const deepSpace = deepSpaceState(self.x, self.y);
  const showDeepSpaceWarning = self.alive && deepSpace.active;
  deepSpaceWarning.hidden = !showDeepSpaceWarning;
  deepSpaceWarning.classList.toggle("visible", showDeepSpaceWarning);
  deepSpaceWarning.setAttribute("aria-hidden", String(!showDeepSpaceWarning));
  const enemyBase = message.motherships.find((base) => base.team !== self.team);
  const showMothershipRangeWarning =
    self.alive && !self.docked && mothershipThreatState(self.x, self.y, enemyBase);
  const threatNow = performance.now();
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
  if (import.meta.env.DEV) {
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
      `ships=${message.ships.length}`,
      `asteroids=${message.asteroids.length}`,
      `projectiles=${message.projectiles.length}`,
      `salvage=${visibleSalvage.length}`,
      `deep-space=${showDeepSpaceWarning}`,
      `mothership-range=${showMothershipRangeWarning}`,
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
  required<HTMLElement>(`#${team}-health`).style.width = `${(base.hp / base.maxHp) * 100}%`;
  required<HTMLElement>(`#${team}-value`).textContent = `${Math.ceil(base.hp)}`;
}

function showToast(message: EventMessage): void {
  toast.textContent = message.text;
  toast.className = `show ${message.tone}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.className = "";
  }, 2200);
}

function resize(): void {
  const dpr = 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
}

function getView(): { scale: number; offsetX: number; offsetY: number } {
  const width = window.innerWidth;
  const height = window.innerHeight;
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
