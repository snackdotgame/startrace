import { client } from "snack:client";
import {
  CLASS_COST,
  MAX_STAT_LEVEL,
  SHIP_PHYSICS,
  TEAM_COLORS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  statCost,
  type ActionMessage,
  type AsteroidView,
  type EventMessage,
  type EffectMessage,
  type MothershipView,
  type ProjectileView,
  type ShipClass,
  type ShipView,
  type SnapshotMessage,
  type Team,
} from "./shared/messages.js";
import {
  PacketKind,
  decodeEffect,
  decodeEvent,
  decodeIdentities,
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
      <div><span>INTEGRITY</span><b id="pilot-health">—</b></div>
      <div><span>CARGO</span><b id="pilot-cargo">0</b></div>
      <div><span>BANK</span><b id="pilot-bank">0</b></div>
      <div><span>TEAM RESERVE</span><b id="team-bank">0</b></div>
    </section>
    <div id="toast"></div>
    <section id="dock-panel">
      <div class="dock-title"><b>MOTHERSHIP LINK</b><span>UPGRADES ARE PERMANENT UNTIL ROUND END</span></div>
      <div class="upgrade-row class-row">
        <button data-action="upgradeClass" data-value="needle"><b>NEEDLE</b><span>PIERCING RAIL</span><em>45</em></button>
        <button data-action="upgradeClass" data-value="hive"><b>HIVE</b><span>SEEKING DRONES</span><em>45</em></button>
        <button data-action="upgradeClass" data-value="star"><b>STAR</b><span>RADIAL BURST</span><em>45</em></button>
        <button data-action="upgradeClass" data-value="chevron"><b>CHEVRON</b><span>IMPACT DASH</span><em>45</em></button>
      </div>
      <div class="upgrade-row stat-row">
        <button data-action="upgradeStat" data-value="weapon"><b>WEAPON</b><span data-level="weapon">○○○</span><em data-cost="weapon">24</em></button>
        <button data-action="upgradeStat" data-value="engine"><b>ENGINE</b><span data-level="engine">○○○</span><em data-cost="engine">24</em></button>
        <button data-action="upgradeStat" data-value="hull"><b>HULL</b><span data-level="hull">○○○</span><em data-cost="hull">24</em></button>
        <button data-action="upgradeStat" data-value="mining"><b>MINING</b><span data-level="mining">○○○</span><em data-cost="mining">24</em></button>
      </div>
      <div class="repair-row">
        <button data-action="repair"><b>REPAIR SHIP</b><span>RESTORE 32 INTEGRITY</span></button>
        <button data-action="repairMothership"><b>REPAIR MOTHERSHIP</b><span>15 TEAM RESERVE</span></button>
        <button class="launch" data-action="dock"><b>LAUNCH</b><span>RETURN TO BATTLE</span></button>
      </div>
    </section>
    <div id="prompt">WASD MOVE · MOUSE AIM/FIRE · E DOCK · R REPAIR</div>
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
  #hud { position: fixed; z-index: 2; inset: 0; pointer-events: none; text-transform: uppercase; letter-spacing: .12em; }
  #brand { position: absolute; top: 20px; left: 22px; font-size: 18px; font-weight: 800; color: #fff; text-shadow: 0 0 12px #63fff3; }
  #brand span { display: block; margin-top: 4px; font-size: 8px; font-weight: 500; color: #63fff3; letter-spacing: .28em; }
  #connection { position: absolute; top: 23px; right: 22px; font-size: 9px; color: #8b9bb4; }
  #sound-toggle { pointer-events: auto; position: absolute; right: 22px; top: 48px; min-height: 0; width: auto; padding: 5px 8px; color: #8295aa; border: 1px solid #24364a; background: #030812cc; font-size: 7px; letter-spacing: .12em; }
  #base-status { position: absolute; top: 18px; left: 50%; width: min(540px, 42vw); transform: translateX(-50%); display: flex; gap: 22px; }
  .base { flex: 1; display: grid; grid-template-columns: 1fr auto; gap: 5px 10px; font-size: 8px; }
  .base b { color: #fff; }
  .base em { grid-column: 2; grid-row: 1 / span 2; align-self: center; font-size: 11px; font-style: normal; }
  .meter { height: 4px; background: #172032; overflow: hidden; }
  .meter i { display: block; width: 100%; height: 100%; transition: width .18s linear; box-shadow: 0 0 9px currentColor; }
  .cyan { color: #63fff3; } .cyan .meter i { background: #63fff3; }
  .magenta { color: #ff5eaa; } .magenta .meter i { background: #ff5eaa; }
  #pilot-panel { position: absolute; left: 22px; top: 78px; width: 170px; padding: 11px 12px; border-left: 1px solid #63fff3; background: linear-gradient(90deg, #09121bd9, transparent); font-size: 9px; }
  #pilot-panel strong { display: block; margin-bottom: 9px; color: #63fff3; font-size: 13px; text-shadow: 0 0 8px currentColor; }
  #pilot-panel div { display: flex; justify-content: space-between; padding: 3px 0; color: #8394a8; }
  #pilot-panel b { color: #fff; }
  #toast { position: absolute; top: 100px; left: 50%; min-width: 260px; padding: 9px 16px; transform: translate(-50%, -8px); opacity: 0; text-align: center; font-size: 10px; background: #061017dc; border: 1px solid #63fff3; color: #63fff3; transition: opacity .16s, transform .16s; }
  #toast.show { opacity: 1; transform: translate(-50%, 0); }
  #toast.bad { border-color: #ff5eaa; color: #ff5eaa; }
  #toast.good { border-color: #ecff45; color: #ecff45; }
  #dock-panel { pointer-events: auto; position: absolute; right: 18px; top: 76px; width: min(430px, calc(100vw - 36px)); padding: 13px; border: 1px solid #63fff3; background: #020711ed; box-shadow: 0 0 28px #16fff020, inset 0 0 22px #16fff00d; opacity: 0; transform: translateX(20px); transition: opacity .18s, transform .18s; pointer-events: none; }
  #dock-panel.visible { opacity: 1; transform: translateX(0); pointer-events: auto; }
  .dock-title { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 11px; color: #63fff3; }
  .dock-title b { font-size: 13px; text-shadow: 0 0 10px currentColor; }
  .dock-title span { font-size: 6px; color: #728499; }
  .upgrade-row, .repair-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 6px; }
  .repair-row { grid-template-columns: 1fr 1fr 1fr; }
  button { min-height: 52px; padding: 8px 6px; color: #dff; border: 1px solid #24475a; background: #07111c; font: inherit; text-align: left; letter-spacing: .07em; cursor: pointer; transition: border-color .12s, background .12s, color .12s; }
  button:hover:not(:disabled) { border-color: #63fff3; background: #0a1b27; color: #63fff3; }
  button:disabled { opacity: .33; cursor: not-allowed; }
  button.current { border-color: #ecff45; color: #ecff45; }
  button b, button span, button em { display: block; }
  button b { font-size: 8px; }
  button span { margin-top: 4px; color: #7890a3; font-size: 6px; line-height: 1.35; }
  button em { margin-top: 5px; color: #ecff45; font-size: 8px; font-style: normal; }
  .stat-row button span { color: #63fff3; letter-spacing: .2em; }
  .launch { border-color: #63fff3; }
  #prompt { position: absolute; bottom: 17px; left: 50%; transform: translateX(-50%); color: #65758a; font-size: 8px; white-space: nowrap; }
  #winner { position: absolute; inset: 0; display: grid; place-content: center; gap: 12px; text-align: center; background: #010207b8; opacity: 0; transition: opacity .25s; }
  #winner.visible { opacity: 1; }
  #winner b { font-size: clamp(34px, 6vw, 88px); color: #fff; text-shadow: 0 0 25px currentColor; }
  #winner span { font-size: 11px; color: #9caabd; }
  #playtest-state, #performance-state { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  @media (max-width: 760px) {
    #brand { top: 12px; left: 12px; font-size: 13px; }
    #connection { display: none; }
    #base-status { top: 12px; left: auto; right: 10px; width: 55vw; transform: none; gap: 8px; }
    .base { font-size: 6px; } .base em { display: none; }
    #pilot-panel { top: 54px; left: 10px; width: 135px; font-size: 7px; }
    #dock-panel { top: auto; bottom: 38px; max-height: 75vh; overflow: auto; }
    .upgrade-row { grid-template-columns: repeat(2, 1fr); }
    .repair-row { grid-template-columns: 1fr; }
    #prompt { font-size: 6px; }
  }
  @media (prefers-reduced-motion: reduce) {
    #toast, #dock-panel, #winner, .meter i { transition: none; }
  }
`;
document.head.append(style);

const canvas = required<HTMLCanvasElement>("#game");
const context = requiredContext(canvas);
let inputSurface: HTMLCanvasElement = canvas;

const connectionLabel = required<HTMLElement>("#connection");
const dockPanel = required<HTMLElement>("#dock-panel");
const toast = required<HTMLElement>("#toast");
const winnerPanel = required<HTMLElement>("#winner");
const soundToggle = required<HTMLButtonElement>("#sound-toggle");
const keys = new Set<string>();
const displayShips = new Map<string, { x: number; y: number; angle: number }>();
const stars = makeStars(48);
const particles: Particle[] = [];
const flashes: Flash[] = [];
const knownProjectiles = new Set<number>();
let projectilesInitialized = false;
const seenEffectIds = new Set<number>();
const effectIdOrder: number[] = [];
const playerNames = new Map<number, string>();
const MAX_EFFECT_PARTICLES = 240;
const MAX_EFFECT_FLASHES = 24;

let snapshot: SnapshotMessage | undefined;
let snapshotReceivedAt = 0;
let cameraX = WORLD_WIDTH / 2;
let cameraY = WORLD_HEIGHT / 2;
let cameraInitialized = false;
let connected = false;
let sequence = 0;
let lastSnapshotSequence = -1;
let lastSnapshotBytes = 0;
let aimScreenX = window.innerWidth / 2;
let aimScreenY = window.innerHeight / 2;
let pointerFire = false;
let toastTimer = 0;
let renderScale = 1;
let lastFrameAt = performance.now();
let predictedSelf: PredictedSelf | undefined;
let currentInput = { moveX: 0, moveY: 0, fire: false };
let shakeStrength = 0;
let shakeX = 0;
let shakeY = 0;
let nextLocalFireAt = 0;
let audioContext: AudioContext | undefined;
let impactNoise: AudioBuffer | undefined;
let soundEnabled = true;
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
if (import.meta.env.DEV) runProtocolSelfTest();
window.addEventListener("resize", resize);
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
window.addEventListener("blur", resetInputState);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    resetInputState();
    sendInput();
  }
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

for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-action]")) {
  button.addEventListener("click", () => {
    const action = button.dataset.action as ActionMessage["action"];
    sendAction(action, button.dataset.value);
  });
}

void client.ready
  .then(() => {
    connected = true;
    connectionLabel.textContent = "MOTHERSHIP LINK STABLE";
    connectionLabel.style.color = "#63fff3";
    window.setInterval(sendInput, 16);
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
  if (event.code === "KeyE") sendAction("dock");
  if (event.code === "KeyR") sendAction("repair");
  if (event.code === "Digit1") sendAction("upgradeClass", "needle");
  if (event.code === "Digit2") sendAction("upgradeClass", "hive");
  if (event.code === "Digit3") sendAction("upgradeClass", "star");
  if (event.code === "Digit4") sendAction("upgradeClass", "chevron");
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
  const dt = Math.min(0.035, Math.max(0.001, frameMs / 1000));
  lastFrameAt = now;
  updatePrediction(dt);
  updateEffects(dt);
  const dpr = 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = "#010207";
  context.fillRect(0, 0, width, height);

  updateCamera();
  const view = getView();
  renderScale = view.scale;
  context.setTransform(
    dpr * view.scale,
    0,
    0,
    dpr * view.scale,
    dpr * (view.offsetX + shakeX),
    dpr * (view.offsetY + shakeY),
  );
  drawWorldBoundary();
  drawStars();

  if (snapshot) {
    for (const asteroid of snapshot.asteroids) drawAsteroid(asteroid);
    for (const item of snapshot.salvage) drawSalvage(item.x, item.y, item.value, now);
    for (const base of snapshot.motherships) drawMothership(base, now);
    for (const projectile of snapshot.projectiles) drawProjectile(projectile, now);
    for (const ship of snapshot.ships) drawShip(ship, now);
  }
  drawEffects();

  drawRadar(dpr, width, height);
  drawTouchControl(dpr);
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
    `protocol=binary-v1`,
    `snapshot=${lastSnapshotBytes}B`,
  ].join(" ");
  maxWorkSinceReport = 0;
  maxParticlesSinceReport = particles.length;
  maxEffectDrawCallsSinceReport = 0;
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

function triggerImmediateWeapon(now: number): void {
  const self = snapshot?.ships.find((ship) => ship.id === snapshot?.selfId);
  if (!self?.alive || self.docked || !predictedSelf || now < nextLocalFireAt) return;
  const physics = SHIP_PHYSICS[self.shipClass];
  nextLocalFireAt = now + (physics.cooldown * 1000) / (1 + self.stats.weapon * 0.14);
  const color = TEAM_COLORS[self.team];

  if (self.shipClass === "chevron") {
    predictedSelf.vx += Math.cos(predictedSelf.angle) * 420;
    predictedSelf.vy += Math.sin(predictedSelf.angle) * 420;
    shakeStrength = Math.max(shakeStrength, 3.5);
    spawnMuzzle(predictedSelf.x, predictedSelf.y, predictedSelf.angle + Math.PI, color, 12);
  } else if (self.shipClass === "star") {
    for (let index = 0; index < 8; index += 1) {
      const angle = (Math.PI * 2 * index) / 8;
      spawnMuzzle(
        predictedSelf.x + Math.cos(angle) * 22,
        predictedSelf.y + Math.sin(angle) * 22,
        angle,
        color,
        2,
      );
    }
  } else if (self.shipClass === "hive") {
    for (const offset of [-0.28, -0.09, 0.09, 0.28]) {
      spawnMuzzle(
        predictedSelf.x + Math.cos(predictedSelf.angle + offset) * 24,
        predictedSelf.y + Math.sin(predictedSelf.angle + offset) * 24,
        predictedSelf.angle + offset,
        color,
        2,
      );
    }
  } else {
    const distance = self.shipClass === "needle" ? 34 : 19;
    spawnMuzzle(
      predictedSelf.x + Math.cos(predictedSelf.angle) * distance,
      predictedSelf.y + Math.sin(predictedSelf.angle) * distance,
      predictedSelf.angle,
      color,
      self.shipClass === "needle" ? 8 : 4,
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

function reconcilePrediction(self: ShipView): void {
  if (!predictedSelf || Math.hypot(predictedSelf.x - self.x, predictedSelf.y - self.y) > 220) {
    predictedSelf = { x: self.x, y: self.y, vx: self.vx, vy: self.vy, angle: self.angle };
    return;
  }
  const correction = self.docked || !self.alive ? 1 : 0.16;
  predictedSelf.x += (self.x - predictedSelf.x) * correction;
  predictedSelf.y += (self.y - predictedSelf.y) * correction;
  predictedSelf.vx += (self.vx - predictedSelf.vx) * 0.2;
  predictedSelf.vy += (self.vy - predictedSelf.vy) * 0.2;
}

function updatePrediction(dt: number): void {
  const self = snapshot?.ships.find((ship) => ship.id === snapshot?.selfId);
  if (!self || !predictedSelf) return;
  if (!self.alive || self.docked) {
    reconcilePrediction(self);
    return;
  }

  const physics = SHIP_PHYSICS[self.shipClass];
  const engine = 1 + self.stats.engine * 0.12;
  predictedSelf.vx += currentInput.moveX * physics.acceleration * engine * dt;
  predictedSelf.vy += currentInput.moveY * physics.acceleration * engine * dt;
  const drag = Math.exp(-physics.drag * dt);
  predictedSelf.vx *= drag;
  predictedSelf.vy *= drag;
  const maximum = physics.speed * engine * (self.dashing ? 1.9 : 1);
  const speed = Math.hypot(predictedSelf.vx, predictedSelf.vy);
  if (speed > maximum) {
    predictedSelf.vx = (predictedSelf.vx / speed) * maximum;
    predictedSelf.vy = (predictedSelf.vy / speed) * maximum;
  }
  predictedSelf.x = clamp(predictedSelf.x + predictedSelf.vx * dt, 22, WORLD_WIDTH - 22);
  predictedSelf.y = clamp(predictedSelf.y + predictedSelf.vy * dt, 22, WORLD_HEIGHT - 22);
  const aim = screenToWorld(aimScreenX, aimScreenY);
  predictedSelf.angle = Math.atan2(aim.y - predictedSelf.y, aim.x - predictedSelf.x);

  for (const asteroid of snapshot?.asteroids ?? []) {
    resolvePredictedCircle(asteroid.x, asteroid.y, asteroid.radius + physics.radius);
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

function updateCamera(): void {
  const self = snapshot?.ships.find((ship) => ship.id === snapshot?.selfId);
  if (!self) {
    return;
  }
  const display = predictedSelf ?? displayShips.get(self.id);
  const targetX = display?.x ?? self.x;
  const targetY = display?.y ?? self.y;
  cameraX += (targetX - cameraX) * 0.3;
  cameraY += (targetY - cameraY) * 0.3;
}

function drawWorldBoundary(): void {
  const boundary = new Path2D();
  boundary.rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  glowStroke(boundary, "#6c65ff", 0.8, 0.22);
}

function drawStars(): void {
  context.fillStyle = "#b9d8e0";
  for (const star of stars) {
    context.globalAlpha = star.alpha;
    context.fillRect(star.x, star.y, 1.3 / renderScale, 1.3 / renderScale);
  }
  context.globalAlpha = 1;
}

function drawAsteroid(asteroid: AsteroidView): void {
  const path = new Path2D();
  const random = seeded(asteroid.seed);
  for (let index = 0; index < 9; index += 1) {
    const angle = (Math.PI * 2 * index) / 9;
    const radius = asteroid.radius * (0.78 + random() * 0.26);
    const x = asteroid.x + Math.cos(angle) * radius;
    const y = asteroid.y + Math.sin(angle) * radius;
    if (index === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
  const integrity = asteroid.hp / asteroid.maxHp;
  glowStroke(path, integrity < 0.35 ? "#ff9f43" : "#dfff43", 1.15, 0.65 + integrity * 0.35);
  glowDot(asteroid.x, asteroid.y, 2.4 + asteroid.radius * 0.035, "#f4ff52");
}

function drawSalvage(x: number, y: number, value: number, now: number): void {
  const pulse = 1 + Math.sin(now * 0.006 + value) * 0.22;
  const radius = (3 + Math.min(3, value * 0.15)) * pulse;
  const path = new Path2D();
  path.moveTo(x, y - radius);
  path.lineTo(x + radius, y);
  path.lineTo(x, y + radius);
  path.lineTo(x - radius, y);
  path.closePath();
  glowStroke(path, "#efff4d", 1.2, 1);
}

function drawMothership(base: MothershipView, now: number): void {
  const color = TEAM_COLORS[base.team];
  const alpha = 0.72 + (base.hp / base.maxHp) * 0.28;
  glowStroke(mothershipPath(base), color, 1.5, alpha);

  const innerX = base.x + (base.team === "cyan" ? base.width / 2 : -base.width / 2);
  for (let index = 0; index < 3; index += 1) {
    const y = base.y + [-220, 0, 220][index];
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

  for (const offset of [-42, 0, 42]) {
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
  const path = new Path2D();
  const left = base.x - base.width / 2;
  const right = base.x + base.width / 2;
  const top = base.y - base.height / 2;
  const bottom = base.y + base.height / 2;
  const ports = [-220, 0, 220].map((offset) => base.y + offset);
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
  return path;
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

function drawShip(ship: ShipView, now: number): void {
  if (!ship.alive) {
    return;
  }
  let display = displayShips.get(ship.id);
  if (!display) {
    display = { x: ship.x, y: ship.y, angle: ship.angle };
    displayShips.set(ship.id, display);
  }
  if (ship.id === snapshot?.selfId && predictedSelf) {
    display.x = predictedSelf.x;
    display.y = predictedSelf.y;
    display.angle = predictedSelf.angle;
  } else {
    display.x += (ship.x - display.x) * 0.42;
    display.y += (ship.y - display.y) * 0.42;
    display.angle += normalizeAngle(ship.angle - display.angle) * 0.46;
  }
  const color = TEAM_COLORS[ship.team];

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
  if (ship.shipClass === "hive") {
    for (let index = 0; index < 4; index += 1) {
      const angle = now * 0.0015 + (Math.PI * 2 * index) / 4;
      drawTriangle(Math.cos(angle) * 32, Math.sin(angle) * 32, angle, 5.5, color, 0.9);
    }
  }
  context.restore();

  const cargoDots = Math.min(3, Math.ceil(ship.cargo / 10));
  for (let index = 0; index < cargoDots; index += 1) {
    glowDot(display.x - 7 + index * 7, display.y + 24, 1.5, "#efff4d");
  }
  if (ship.hp < ship.maxHp) {
    const width = 34;
    const pathHp = new Path2D();
    pathHp.moveTo(display.x - width / 2, display.y - 27);
    pathHp.lineTo(display.x - width / 2 + width * (ship.hp / ship.maxHp), display.y - 27);
    glowStroke(pathHp, color, 1, 0.75);
  }
  drawName(ship, display.x, display.y);
}

function shipPath(shipClass: ShipClass): Path2D {
  const path = new Path2D();
  if (shipClass === "needle") {
    path.moveTo(36, 0);
    path.lineTo(-28, -7);
    path.lineTo(-28, 7);
    path.closePath();
    path.moveTo(-19, 0);
    path.lineTo(25, 0);
  } else if (shipClass === "hive") {
    path.arc(0, 0, 18, 0, Math.PI * 2);
  } else if (shipClass === "star") {
    for (let index = 0; index < 12; index += 1) {
      const angle = (Math.PI * 2 * index) / 12;
      const radius = index % 2 === 0 ? 25 : 10;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (index === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
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
  return path;
}

function drawName(ship: ShipView, x: number, y: number): void {
  context.save();
  context.globalAlpha = ship.id === snapshot?.selfId ? 0.95 : 0.55;
  context.fillStyle = ship.id === snapshot?.selfId ? "#ffffff" : TEAM_COLORS[ship.team];
  context.font = `${9 / renderScale}px ui-monospace, monospace`;
  context.textAlign = "center";
  context.fillText(ship.name.toUpperCase(), x, y + 39 / renderScale);
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
  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = color;
  context.shadowColor = color;
  context.shadowBlur = 18;
  context.globalAlpha = alpha * 0.13;
  context.lineWidth = 8 / renderScale;
  context.stroke(path);
  context.shadowBlur = 10;
  context.globalAlpha = alpha * 0.38;
  context.lineWidth = 3.4 / renderScale;
  context.stroke(path);
  context.shadowBlur = 4;
  context.globalAlpha = alpha;
  context.lineWidth = width / renderScale;
  context.stroke(path);
  context.restore();
}

function glowDot(x: number, y: number, radius: number, color: string): void {
  context.save();
  context.globalCompositeOperation = "lighter";
  context.fillStyle = color;
  context.shadowColor = color;
  context.shadowBlur = 16;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function spawnImpact(message: EffectMessage): void {
  if (seenEffectIds.has(message.id)) return;
  seenEffectIds.add(message.id);
  effectIdOrder.push(message.id);
  while (effectIdOrder.length > 256) {
    const expired = effectIdOrder.shift();
    if (expired !== undefined) seenEffectIds.delete(expired);
  }

  const breaking = message.kind === "asteroidBreak" || message.kind === "shipBreak";
  const color = message.kind.startsWith("asteroid")
    ? "#efff4d"
    : message.team
      ? TEAM_COLORS[message.team]
      : "#ffffff";
  const motionScale = reducedMotion.matches ? 0.45 : 1;
  const sparkCount = Math.round((7 + message.intensity * 9) * motionScale);
  for (let index = 0; index < sparkCount; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (90 + Math.random() * 280) * (0.6 + message.intensity * 0.35);
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
    life: breaking ? 0.32 : 0.18,
    maxLife: breaking ? 0.32 : 0.18,
    radius: (breaking ? 25 : 12) * Math.max(0.75, message.intensity),
    color,
  });
  const distance = Math.hypot(message.x - cameraX, message.y - cameraY);
  const proximity = clamp(1 - distance / 1500, 0, 1);
  if (!reducedMotion.matches) {
    shakeStrength = Math.max(shakeStrength, proximity * message.intensity * (breaking ? 7 : 3.5));
  }
  playImpactSound(message, proximity);
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
    context.shadowColor = batch.color;
    context.shadowBlur = 5;
    context.globalAlpha = batch.alpha * 0.72;
    context.lineWidth = (batch.width * 2.2) / renderScale;
    context.stroke(batch.path);
    context.shadowBlur = 0;
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
    turret: [660, 250],
  };
  const [start, end] = frequencies[kind] ?? frequencies.bolt;
  oscillator.type = kind === "needle" ? "sawtooth" : kind === "chevron" ? "square" : "triangle";
  oscillator.frequency.setValueAtTime(start * (0.97 + Math.random() * 0.06), now);
  oscillator.frequency.exponentialRampToValueAtTime(end, now + 0.09);
  gain.gain.setValueAtTime(Math.max(0.0001, volume * 0.075), now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.11);
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
  const mapX = (x: number): number => left + padding + (x / WORLD_WIDTH) * innerWidth;
  const mapY = (y: number): number => top + padding + (y / WORLD_HEIGHT) * innerHeight;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.save();
  context.globalCompositeOperation = "source-over";
  context.fillStyle = "#020711d9";
  context.fillRect(left, top, width, height);
  context.strokeStyle = "#65758a88";
  context.lineWidth = 1;
  context.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);

  for (const asteroid of snapshot.asteroids) {
    context.fillStyle = "#efff4d66";
    context.fillRect(mapX(asteroid.x), mapY(asteroid.y), 1.5, 1.5);
  }
  for (const base of snapshot.motherships) {
    context.strokeStyle = TEAM_COLORS[base.team];
    context.shadowColor = TEAM_COLORS[base.team];
    context.shadowBlur = 5;
    context.beginPath();
    context.moveTo(mapX(base.x), mapY(base.y - base.height / 2));
    context.lineTo(mapX(base.x), mapY(base.y + base.height / 2));
    context.stroke();
  }
  for (const ship of snapshot.ships) {
    if (!ship.alive) continue;
    context.fillStyle = ship.id === snapshot.selfId ? "#ffffff" : TEAM_COLORS[ship.team];
    context.shadowColor = context.fillStyle;
    context.shadowBlur = ship.id === snapshot.selfId ? 7 : 3;
    context.beginPath();
    context.arc(
      mapX(ship.x),
      mapY(ship.y),
      ship.id === snapshot.selfId ? 2.5 : 1.5,
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  const visibleWorldWidth = screenWidth / renderScale;
  const visibleWorldHeight = screenHeight / renderScale;
  const view = getView();
  const visibleCenterX = (screenWidth / 2 - view.offsetX) / view.scale;
  const visibleCenterY = (screenHeight / 2 - view.offsetY) / view.scale;
  context.shadowBlur = 0;
  context.strokeStyle = "#ffffff55";
  context.strokeRect(
    mapX(visibleCenterX - visibleWorldWidth / 2),
    mapY(visibleCenterY - visibleWorldHeight / 2),
    (visibleWorldWidth / WORLD_WIDTH) * innerWidth,
    (visibleWorldHeight / WORLD_HEIGHT) * innerHeight,
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
  required<HTMLElement>("#pilot-health").textContent =
    `${Math.max(0, Math.ceil(self.hp))} / ${Math.ceil(self.maxHp)}`;
  required<HTMLElement>("#pilot-cargo").textContent = String(self.cargo);
  required<HTMLElement>("#pilot-bank").textContent = String(self.bank);
  required<HTMLElement>("#team-bank").textContent = String(message.teamBank[self.team]);
  dockPanel.classList.toggle("visible", self.docked);
  if (import.meta.env.DEV) {
    required<HTMLOutputElement>("#playtest-state").value = [
      `x=${self.x.toFixed(1)}`,
      `y=${self.y.toFixed(1)}`,
      `docked=${self.docked}`,
      `alive=${self.alive}`,
      `class=${self.shipClass}`,
      `cargo=${self.cargo}`,
      `bank=${self.bank}`,
      `ships=${message.ships.length}`,
      `projectiles=${message.projectiles.length}`,
    ].join(" ");
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    'button[data-action="upgradeClass"]',
  )) {
    button.classList.toggle("current", button.dataset.value === self.shipClass);
    button.disabled = self.bank < CLASS_COST || button.dataset.value === self.shipClass;
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
  const scale = clamp(height / 1000, 0.5, 1.35);
  return {
    scale,
    offsetX: width / 2 - cameraX * scale,
    offsetY: height / 2 - cameraY * scale,
  };
}

function screenToWorld(x: number, y: number): { x: number; y: number } {
  const view = getView();
  return {
    x: clamp((x - view.offsetX) / view.scale, 0, WORLD_WIDTH),
    y: clamp((y - view.offsetY) / view.scale, 0, WORLD_HEIGHT),
  };
}

function makeStars(count: number): Array<{ x: number; y: number; alpha: number }> {
  const random = seeded(1979);
  return Array.from({ length: count }, () => ({
    x: random() * WORLD_WIDTH,
    y: random() * WORLD_HEIGHT,
    alpha: 0.18 + random() * 0.55,
  }));
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
