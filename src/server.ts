import { server, type Connection } from "snack:server";
import {
  CLASS_UPGRADE_OPTIONS,
  MAX_STAT_LEVEL,
  MOTHERSHIP_HEIGHT,
  MOTHERSHIP_LOCK_ON_MS,
  MOTHERSHIP_MAX_HP,
  MOTHERSHIP_PLAYER_TARGET_RANGE,
  MOTHERSHIP_TURRET_MOUNTS,
  MOTHERSHIP_WIDTH,
  MOTHERSHIP_X_INSET,
  ROOKIE_PROTECTED_MAX_TIER,
  ROOKIE_SECTOR_MARGIN,
  RAM_IMPACT_PROFILES,
  SHIP_PHYSICS,
  SHIP_WEAPONS,
  STAT_BONUSES,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  classResearchRequirement,
  classUpgradeCost,
  miningMagnetPull,
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
  type ProjectileKind,
  type ProjectileView,
  type SalvageView,
  type ShipClass,
  type ShipStats,
  type ShipView,
  type SnapshotMessage,
  type StatName,
  type Team,
} from "./shared/messages.js";
import {
  DATAGRAM_BUDGET_BYTES,
  MAX_SALVAGE_PACKET_ITEMS,
  MAX_SNAPSHOT_ASTEROIDS,
  MAX_SNAPSHOT_PROJECTILES,
  MAX_SNAPSHOT_SHIPS,
  decodeAction,
  decodeInput,
  encodeEffect,
  encodeEvent,
  encodeIdentities,
  encodeSalvageSnapshot,
  encodeSnapshot,
} from "./shared/protocol.js";

const FIXED_STEP_MS = 1000 / 60;
const MAX_CATCH_UP_STEPS = 3;
const SNAPSHOT_MS = 33;
const SALVAGE_SNAPSHOT_MS = 100;
const ASTEROID_COUNT = 160;
const INTEREST_RADIUS = 1400;
const ASTEROID_SPAWN_MIN_DISTANCE = 350;
const ASTEROID_SPAWN_DISTANCE_RANGE = 1900;
const CENTER_ASTEROID_SPAWN_MIN_DISTANCE = 120;
const CENTER_ASTEROID_SPAWN_DISTANCE_RANGE = 1250;
const MOTHERSHIP_ASTEROID_DEFENSE_RADIUS = 950;
const MOTHERSHIP_IMMEDIATE_DEFENSE_MARGIN = 420;
const MOTHERSHIP_ASTEROID_TARGET_RANGE = 1500;
const MOTHERSHIP_TURRET_PROJECTILE_SPEED = 1650;
const MOTHERSHIP_TURRET_MIN_PLAYER_DAMAGE = 2;
const MOTHERSHIP_TURRET_DAMAGE_FRACTION_BY_TIER = [1, 0.15, 0.08, 0.045, 0.022] as const;
const MOTHERSHIP_TURRET_ASTEROID_DAMAGE = 60;
const MOTHERSHIP_TURRET_RELOAD_MS = 650;
const MOTHERSHIP_PLAYER_VOLLEY_MS = 500;
const MOTHERSHIP_ASTEROID_VOLLEY_MS = 220;
const RESPAWN_DELAY_MS = 4000;
const APEX_MIN_SIEGE_SECONDS = 29;
const APEX_MAX_SIEGE_SECONDS = 32;
const MAX_PROJECTILES = 180;
const MAX_SALVAGE = MAX_SALVAGE_PACKET_ITEMS;
const SALVAGE_VISIBILITY_RADIUS = 3200;
const DEATH_STAT_LEVELS_LOST = 2;
const BALANCE_REPORT_MS = 60_000;
const KILL_BOUNTY_BASE = 6;
const KILL_BOUNTY_PER_TIER = 12;
const KILL_BOUNTY_PER_STAT = 2;
const DEFAULT_BOT_FILL = 8;
const MAX_COMBATANTS = 32;
const RAM_KNOCKBACK_DURATION_MS = 260;
const BOT_DECISION_MS = 140;
const BOT_ATTACK_TIER = 2;
const BOT_ATTACK_DURATION_MS = 15_000;
const BOT_ATTACK_COOLDOWN_MS = 42_000;
const BOT_LOW_HULL_RATIO = 0.42;
const BOT_MAX_CARGO_TARGET = 220;
const BOT_SALVAGE_CLAIM_SEPARATION = 150;
const BOT_ASTEROID_CLAIM_SEPARATION = 260;
const BOT_SALVAGE_STALL_MS = 1200;
const BOT_SALVAGE_IGNORE_MS = 1800;
const BOT_LAUNCH_COMMIT_MS = 1600;
const BOT_MOTHERSHIP_RESOURCE_CLEARANCE = 60;
const ASTEROID_MOTHERSHIP_SPAWN_MARGIN = 90;

type AsteroidHome = Team | "center";

interface AsteroidKindConfig {
  hpPerRadius: number;
  salvageMultiplier: number;
  minimumRadius: number;
  radiusRange: number;
  speedMultiplier: number;
}

interface AsteroidKindThreshold {
  kind: AsteroidKind;
  maximumRoll: number;
}

const ASTEROID_KIND_CONFIG: Record<AsteroidKind, AsteroidKindConfig> = {
  rock: {
    hpPerRadius: 2.2,
    salvageMultiplier: 1,
    minimumRadius: 27,
    radiusRange: 35,
    speedMultiplier: 1,
  },
  iron: {
    hpPerRadius: 3,
    salvageMultiplier: 1.35,
    minimumRadius: 32,
    radiusRange: 33,
    speedMultiplier: 0.85,
  },
  crystal: {
    hpPerRadius: 1.75,
    salvageMultiplier: 2,
    minimumRadius: 24,
    radiusRange: 32,
    speedMultiplier: 1.2,
  },
  core: {
    hpPerRadius: 3.4,
    salvageMultiplier: 3,
    minimumRadius: 40,
    radiusRange: 28,
    speedMultiplier: 0.7,
  },
};

const BASE_ASTEROID_KINDS: readonly AsteroidKindThreshold[] = [
  { kind: "rock", maximumRoll: 0.72 },
  { kind: "iron", maximumRoll: 0.94 },
  { kind: "crystal", maximumRoll: 1 },
];
const CENTER_ASTEROID_KINDS: readonly AsteroidKindThreshold[] = [
  { kind: "rock", maximumRoll: 0.34 },
  { kind: "iron", maximumRoll: 0.64 },
  { kind: "crystal", maximumRoll: 0.89 },
  { kind: "core", maximumRoll: 1 },
];

type BotMode = "mine" | "return" | "attack";

interface BotBrain {
  serial: number;
  mode: BotMode;
  nextDecisionAt: number;
  nextAttackAt: number;
  attackUntil: number;
  laneY: number;
  strafeSign: number;
  salvageTargetId: number | null;
  asteroidTargetId: number | null;
  salvageProgressTargetId: number | null;
  salvageBestDistance: number;
  salvageLastProgressAt: number;
  ignoredSalvageId: number | null;
  ignoredSalvageUntil: number;
  launchUntil: number;
}

interface BotResourceClaim {
  id: number;
  x: number;
  y: number;
}

interface ControlState {
  sequence: number;
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fire: boolean;
}

interface PlayerState extends ShipView {
  wireId: number;
  bot: BotBrain | null;
  input: ControlState;
  lastInputAt: number;
  nextFireAt: number;
  respawnAt: number;
  dashUntil: number;
  dashHits: Set<string>;
  ramKnockbackUntil: number;
  mothershipThreatEnteredAt: number | null;
}

interface MothershipState extends MothershipView {
  nextTurretAt: number[];
  nextVolleyAt: number;
}

interface AsteroidState extends AsteroidView {
  nextMothershipImpactAt: number;
  home: AsteroidHome;
}

interface SalvageState extends SalvageView {
  vx: number;
  vy: number;
}

interface ProjectileState extends ProjectileView {
  ownerId: string;
  damage: number;
  asteroidDamage: number;
  expiresAt: number;
  pierce: number;
  createdAt: number;
  sourceClass?: ShipClass;
  rookieProtectedAtLaunch?: boolean;
}

interface ClassBalanceMetrics {
  picks: number;
  playerDamage: number;
  baseDamage: number;
  kills: number;
  deaths: number;
}

interface BalanceMilestone {
  team: Team;
  elapsedSeconds: number;
}

interface RoundBalanceMetrics {
  startedAt: number;
  nextReportAt: number;
  deposits: Record<Team, number>;
  depositedSalvage: Record<Team, number>;
  playerKills: Record<Team, number>;
  playerBaseDamage: Record<Team, number>;
  asteroidBaseDamage: Record<Team, number>;
  turretShots: number;
  turretAsteroidHits: number;
  turretHits: number;
  turretKills: number;
  turretWarningMs: number;
  turretWarningSamples: number;
  turretFlightMs: number;
  botDockings: number;
  botLaunches: number;
  botUnfundedDockings: number;
  firstTransform: BalanceMilestone | null;
  firstKill: BalanceMilestone | null;
  firstPlayerBaseDamage: BalanceMilestone | null;
  classes: Partial<Record<ShipClass, ClassBalanceMetrics>>;
}

type DamageSource =
  | { kind: "player"; playerId: string; team: Team; shipClass: ShipClass }
  | { kind: "turret"; team: Team }
  | { kind: "environment" };

const CLASS_CONFIG = SHIP_PHYSICS;

const players = new Map<string, PlayerState>();
const motherships: Record<Team, MothershipState> = {
  cyan: {
    team: "cyan",
    x: MOTHERSHIP_X_INSET,
    y: WORLD_HEIGHT / 2,
    width: MOTHERSHIP_WIDTH,
    height: MOTHERSHIP_HEIGHT,
    hp: MOTHERSHIP_MAX_HP,
    maxHp: MOTHERSHIP_MAX_HP,
    nextTurretAt: MOTHERSHIP_TURRET_MOUNTS.map(() => 0),
    nextVolleyAt: 0,
  },
  magenta: {
    team: "magenta",
    x: WORLD_WIDTH - MOTHERSHIP_X_INSET,
    y: WORLD_HEIGHT / 2,
    width: MOTHERSHIP_WIDTH,
    height: MOTHERSHIP_HEIGHT,
    hp: MOTHERSHIP_MAX_HP,
    maxHp: MOTHERSHIP_MAX_HP,
    nextTurretAt: MOTHERSHIP_TURRET_MOUNTS.map(() => 0),
    nextVolleyAt: 0,
  },
};
const teamBank: Record<Team, number> = { cyan: 0, magenta: 0 };
let asteroids: AsteroidState[] = [];
let salvage: SalvageState[] = [];
let projectiles: ProjectileState[] = [];
let nextEntityId = 1;
let nextEffectId = 1;
let nextPlayerWireId = 1;
let nextSnapshotSequence = 1;
let nextSalvageSequence = 1;
let nextBotSerial = 0;
let configuredBotFill = DEFAULT_BOT_FILL;
let winner: Team | null = null;
let resetAt = 0;
let balanceMetrics = createBalanceMetrics(0);

export async function main(): Promise<void> {
  validateBalanceTuning();
  configuredBotFill = readBotFillConfig();
  resetRound(0);
  let nextTick = server.elapsedMs();
  let lastSnapshot = 0;
  let lastSalvageSnapshot = 0;

  while (server.running) {
    const now = server.elapsedMs();

    syncConnections(now);
    for (const event of server.datagrams.drain()) {
      const player = players.get(event.connection.id);
      const input = decodeInput(event.bytes);
      if (player && input && input.sequence >= player.input.sequence) {
        player.input = input;
        player.lastInputAt = now;
      }
    }
    for (const event of server.streams.drain()) {
      const player = players.get(event.connection.id);
      const action = decodeAction(event.bytes);
      if (player && action) handleAction(player, action, now);
    }

    let catchUpSteps = 0;
    while (now >= nextTick && catchUpSteps < MAX_CATCH_UP_STEPS) {
      update(FIXED_STEP_MS / 1000, nextTick);
      nextTick += FIXED_STEP_MS;
      catchUpSteps += 1;
    }
    if (now >= nextTick) nextTick = now + FIXED_STEP_MS;
    if (now - lastSnapshot >= SNAPSHOT_MS) {
      sendSnapshots(now);
      lastSnapshot = now;
    }
    if (now - lastSalvageSnapshot >= SALVAGE_SNAPSHOT_MS) {
      sendSalvageSnapshots();
      lastSalvageSnapshot = now;
    }

    await server.sleep(Math.max(1, nextTick - server.elapsedMs()));
  }
}

function syncConnections(now: number): void {
  const live = new Set(server.connections.map((connection) => connection.id));
  let rosterChanged = false;
  for (const [id, player] of players) {
    if (!player.bot && !live.has(id)) {
      players.delete(id);
      rosterChanged = true;
    }
  }

  for (const connection of server.connections) {
    if (!players.has(connection.id)) {
      if (players.size >= MAX_COMBATANTS && !removeOneBot()) {
        connection.close("game is full");
        continue;
      }
      const team = smallerHumanTeam();
      const player = createPlayer(connection, team, now);
      players.set(connection.id, player);
      classMetrics("scout").picks += 1;
      rosterChanged = true;
      sendEvent(connection.id, `Joined ${team.toUpperCase()} team`, "good");
    }
  }
  rosterChanged = syncBots(now) || rosterChanged;
  if (rosterChanged) broadcastIdentities();
}

function readBotFillConfig(): number {
  const raw = server.config.botFill;
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw)
        : raw === false
          ? 0
          : DEFAULT_BOT_FILL;
  if (!Number.isFinite(value)) return DEFAULT_BOT_FILL;
  return clamp(Math.round(value), 0, MAX_COMBATANTS);
}

function smallerHumanTeam(): Team {
  let cyan = 0;
  let magenta = 0;
  for (const player of players.values()) {
    if (player.bot) continue;
    if (player.team === "cyan") {
      cyan += 1;
    } else {
      magenta += 1;
    }
  }
  return cyan <= magenta ? "cyan" : "magenta";
}

function teamCounts(): Record<Team, number> {
  const counts: Record<Team, number> = { cyan: 0, magenta: 0 };
  for (const player of players.values()) counts[player.team] += 1;
  return counts;
}

function syncBots(now: number): boolean {
  let humans = 0;
  let bots = 0;
  for (const player of players.values()) {
    if (player.bot) bots += 1;
    else humans += 1;
  }
  const desired = Math.max(0, Math.min(configuredBotFill - humans, MAX_COMBATANTS - humans));
  let changed = false;
  while (bots < desired) {
    addBot(now);
    bots += 1;
    changed = true;
  }
  while (bots > desired) {
    if (!removeOneBot()) break;
    bots -= 1;
    changed = true;
  }
  return changed;
}

function addBot(now: number): void {
  const counts = teamCounts();
  const team: Team = counts.cyan <= counts.magenta ? "cyan" : "magenta";
  const serial = nextBotSerial++;
  const names = ["VECTOR", "NOVA", "SPARK", "COMET", "PULSE", "PRISM", "ORBIT", "FLARE"];
  const bot: BotBrain = {
    serial,
    mode: "mine",
    nextDecisionAt: now,
    nextAttackAt: now + 35_000 + (serial % 4) * 5000,
    attackUntil: 0,
    laneY: WORLD_HEIGHT / 2 + ((serial % 5) - 2) * 220,
    strafeSign: serial % 2 === 0 ? 1 : -1,
    salvageTargetId: null,
    asteroidTargetId: null,
    salvageProgressTargetId: null,
    salvageBestDistance: Number.POSITIVE_INFINITY,
    salvageLastProgressAt: now,
    ignoredSalvageId: null,
    ignoredSalvageUntil: 0,
    launchUntil: now + BOT_LAUNCH_COMMIT_MS,
  };
  const id = `bot:${serial}`;
  const player = createPlayerState(id, `BOT ${names[serial % names.length]}`, team, now, bot);
  players.set(id, player);
  classMetrics("scout").picks += 1;
}

function removeOneBot(): boolean {
  const counts = teamCounts();
  const preferredTeam: Team = counts.cyan >= counts.magenta ? "cyan" : "magenta";
  const entry =
    Array.from(players).find(([, player]) => player.bot && player.team === preferredTeam) ??
    Array.from(players).find(([, player]) => player.bot);
  if (!entry) return false;
  players.delete(entry[0]);
  return true;
}

function allocateWireId(): number {
  const used = new Set(Array.from(players.values(), (player) => player.wireId));
  for (let attempts = 0; attempts < 0xffff; attempts += 1) {
    const candidate = nextPlayerWireId;
    nextPlayerWireId = nextPlayerWireId === 0xffff ? 1 : nextPlayerWireId + 1;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Player wire id space exhausted");
}

function broadcastIdentities(): void {
  server.streams.broadcast(
    encodeIdentities(
      Array.from(players.values(), ({ wireId, name }) => ({ id: wireId, name })),
      true,
    ),
  );
}

function createPlayer(connection: Connection, team: Team, now: number): PlayerState {
  return createPlayerState(connection.id, connection.userName.slice(0, 24), team, now, null);
}

function createPlayerState(
  id: string,
  name: string,
  team: Team,
  now: number,
  bot: BotBrain | null,
): PlayerState {
  const spawn = spawnPoint(team);
  const stats = emptyStats();
  return {
    id,
    wireId: allocateWireId(),
    name,
    team,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    angle: team === "cyan" ? 0 : Math.PI,
    hp: CLASS_CONFIG.scout.maxHp,
    maxHp: CLASS_CONFIG.scout.maxHp,
    cargo: 0,
    bank: 0,
    research: 0,
    shipClass: "scout",
    stats,
    docked: true,
    alive: true,
    respawnIn: 0,
    dashing: false,
    bot,
    input: {
      sequence: 0,
      moveX: 0,
      moveY: 0,
      aimX: team === "cyan" ? WORLD_WIDTH : 0,
      aimY: WORLD_HEIGHT / 2,
      fire: false,
    },
    nextFireAt: now,
    lastInputAt: now,
    respawnAt: 0,
    dashUntil: 0,
    dashHits: new Set<string>(),
    ramKnockbackUntil: 0,
    mothershipThreatEnteredAt: null,
  };
}

function emptyStats(): ShipStats {
  return { weapon: 0, engine: 0, hull: 0, mining: 0 };
}

function updateBotInput(player: PlayerState, now: number): void {
  const brain = player.bot;
  if (!brain) return;
  player.lastInputAt = now;
  if (!player.alive || winner) {
    clearBotResourceTargets(brain);
    setBotIntent(
      player,
      0,
      0,
      player.x + Math.cos(player.angle),
      player.y + Math.sin(player.angle),
      false,
    );
    return;
  }
  if (now < brain.nextDecisionAt) return;
  brain.nextDecisionAt = now + BOT_DECISION_MS + (brain.serial % 4) * 9;
  player.input.sequence = (player.input.sequence + 1) >>> 0;

  if (player.docked) {
    clearBotResourceTargets(brain);
    botUseDock(player, brain, now);
    setBotLaunchIntent(player, brain);
    return;
  }

  if (now < brain.launchUntil) {
    clearBotResourceTargets(brain);
    setBotLaunchIntent(player, brain);
    return;
  }

  const cargoTarget = botCargoTarget(player, brain);
  const lowHull = player.hp / Math.max(1, player.maxHp) <= BOT_LOW_HULL_RATIO;
  if (
    (lowHull && botCanFundRepair(player)) ||
    player.cargo >= cargoTarget ||
    (brain.mode === "attack" && now >= brain.attackUntil)
  ) {
    brain.mode = "return";
  }
  if (brain.mode === "attack" && shipTransformTier(player.shipClass) < BOT_ATTACK_TIER) {
    brain.mode = "mine";
  }

  const nearbyEnemy = nearestEnemyPlayer(player, 620);
  if (brain.mode === "return") {
    clearBotResourceTargets(brain);
    const base = motherships[player.team];
    const targetY = clamp(
      brain.laneY,
      base.y - base.height / 2 + CLASS_CONFIG[player.shipClass].radius + 18,
      base.y + base.height / 2 - CLASS_CONFIG[player.shipClass].radius - 18,
    );
    setBotMovement(player, base.x, targetY, 0, false, brain.strafeSign);
    if (nearbyEnemy) aimBotAt(player, nearbyEnemy, now, true);
    else setBotAim(player, base.x, targetY, false);
    return;
  }

  if (brain.mode === "attack") {
    clearBotResourceTargets(brain);
    botAttack(player, brain, nearbyEnemy, now);
    return;
  }

  if (nearbyEnemy) {
    clearBotResourceTargets(brain);
    setBotMovement(player, nearbyEnemy.x, nearbyEnemy.y, 260, true, brain.strafeSign);
    aimBotAt(player, nearbyEnemy, now, true);
    return;
  }

  const salvageTarget = nearestSalvageForBot(player, 1500, now);
  if (salvageTarget) {
    setBotMovement(player, salvageTarget.x, salvageTarget.y, 0, false, brain.strafeSign);
    setBotAim(player, salvageTarget.x, salvageTarget.y, false);
    return;
  }

  const asteroidTarget = nearestAsteroidForBot(player, 2100);
  if (asteroidTarget) {
    const weapon = SHIP_WEAPONS[player.shipClass];
    const dash = weapon.mode === "dash";
    const standOff = dash ? 0 : 210 + asteroidTarget.radius;
    setBotMovement(player, asteroidTarget.x, asteroidTarget.y, standOff, !dash, brain.strafeSign);
    const distance = Math.hypot(asteroidTarget.x - player.x, asteroidTarget.y - player.y);
    const reach = dash
      ? 330
      : Math.min(900, Math.max(520, CLASS_CONFIG[player.shipClass].bulletSpeed * 1.05));
    aimBotAt(player, asteroidTarget, now, distance <= reach);
    return;
  }

  const direction = player.team === "cyan" ? 1 : -1;
  setBotIntent(player, direction * 0.7, 0, player.x + direction * 500, player.y, false);
}

function botUseDock(player: PlayerState, brain: BotBrain, now: number): void {
  brain.launchUntil = now + BOT_LAUNCH_COMMIT_MS;
  for (let repairs = 0; repairs < 4 && player.hp < player.maxHp * 0.9; repairs += 1) {
    const before = player.hp;
    repairPlayer(player);
    if (player.hp <= before) break;
  }
  botSpendBank(player, brain, now);
  const base = motherships[player.team];
  if (base.hp < base.maxHp * 0.68 && teamBank[player.team] >= 15) repairMothership(player);

  if (brain.mode === "attack" && now < brain.attackUntil) {
    return;
  }
  if (shipTransformTier(player.shipClass) >= BOT_ATTACK_TIER && now >= brain.nextAttackAt) {
    brain.mode = "attack";
    brain.attackUntil = now + BOT_ATTACK_DURATION_MS;
    brain.nextAttackAt = now + BOT_ATTACK_COOLDOWN_MS;
  } else {
    brain.mode = "mine";
  }
}

function setBotLaunchIntent(player: PlayerState, brain: BotBrain): void {
  const direction = botLaunchDirection(player.team);
  const laneOffset = clamp((brain.laneY - player.y) / 240, -0.45, 0.45);
  setBotIntent(
    player,
    direction,
    laneOffset,
    player.x + direction * 600,
    player.y + laneOffset * 300,
    false,
  );
}

function botLaunchDirection(team: Team): 1 | -1 {
  return team === "cyan" ? 1 : -1;
}

function botSpendBank(player: PlayerState, brain: BotBrain, now: number): void {
  const statPriority: readonly StatName[] = ["mining", "weapon", "engine", "hull"];
  for (let action = 0; action < 12; action += 1) {
    const options = CLASS_UPGRADE_OPTIONS[player.shipClass];
    if (options?.length) {
      const target = options[(brain.serial + shipTransformTier(player.shipClass)) % options.length];
      const cost = classUpgradeCost(player.shipClass, target);
      const research = classResearchRequirement(player.shipClass, target);
      if (cost !== undefined && research !== undefined && player.research >= research) {
        if (player.bank < cost) return;
        upgradeClass(player, target, now);
        continue;
      }
      if (player.stats.mining === 0 && player.bank >= statCost(0)) {
        upgradeStat(player, "mining");
      }
      return;
    }

    const available = statPriority.filter((stat) => player.stats[stat] < MAX_STAT_LEVEL);
    if (available.length === 0) return;
    const minimumLevel = Math.min(...available.map((stat) => player.stats[stat]));
    const stat = available.find((candidate) => player.stats[candidate] === minimumLevel);
    if (!stat || player.bank < statCost(player.stats[stat])) return;
    upgradeStat(player, stat);
  }
}

function botCargoTarget(player: PlayerState, brain: BotBrain): number {
  const options = CLASS_UPGRADE_OPTIONS[player.shipClass];
  if (!options?.length) return 150;
  const target = options[(brain.serial + shipTransformTier(player.shipClass)) % options.length];
  const cost = classUpgradeCost(player.shipClass, target) ?? 0;
  const research = classResearchRequirement(player.shipClass, target) ?? 0;
  const researchNeeded = Math.max(0, research - player.research);
  const bankNeeded = Math.max(0, cost - player.bank);
  const grossForBank = Math.ceil(bankNeeded / 0.75);
  return clamp(Math.max(70, researchNeeded, grossForBank), 70, BOT_MAX_CARGO_TARGET);
}

function botCanFundRepair(player: Pick<PlayerState, "bank" | "cargo" | "hp" | "maxHp">): boolean {
  return player.bank + personalCargoValue(player.cargo) >= nextPlayerRepairCost(player);
}

function botAttack(
  player: PlayerState,
  brain: BotBrain,
  nearbyEnemy: PlayerState | undefined,
  now: number,
): void {
  const base = motherships[otherTeam(player.team)];
  const approachDirection = player.team === "cyan" ? -1 : 1;
  const standOffX = base.x + approachDirection * (base.width / 2 + 260);
  const standOffY = clamp(brain.laneY, base.y - base.height * 0.36, base.y + base.height * 0.36);
  setBotMovement(player, standOffX, standOffY, 45, true, brain.strafeSign);
  if (nearbyEnemy) {
    aimBotAt(player, nearbyEnemy, now, true);
    return;
  }
  const distanceToBase = distanceToRect(player.x, player.y, base);
  const dash = SHIP_WEAPONS[player.shipClass].mode === "dash";
  if (dash && distanceToBase < 430) {
    setBotMovement(player, base.x, base.y, 0, false, brain.strafeSign);
  }
  setBotAim(player, base.x, base.y, distanceToBase <= (dash ? 430 : 820));
}

function nearestEnemyPlayer(player: PlayerState, maximumDistance: number): PlayerState | undefined {
  let nearest: PlayerState | undefined;
  let bestDistanceSquared = maximumDistance * maximumDistance;
  for (const candidate of players.values()) {
    if (
      !candidate.alive ||
      candidate.docked ||
      candidate.team === player.team ||
      rookieProtectionActive(candidate)
    ) {
      continue;
    }
    const candidateDistanceSquared = distanceSquared(player.x, player.y, candidate.x, candidate.y);
    if (candidateDistanceSquared < bestDistanceSquared) {
      nearest = candidate;
      bestDistanceSquared = candidateDistanceSquared;
    }
  }
  return nearest;
}

function nearestSalvageForBot(
  player: PlayerState,
  maximumDistance: number,
  now: number,
): SalvageState | undefined {
  const brain = player.bot;
  if (!brain) return undefined;
  if (brain.salvageTargetId !== null) {
    const current = salvage.find((item) => item.id === brain.salvageTargetId);
    if (
      current &&
      botResourceInMiningLane(player.team, current) &&
      distanceSquared(player.x, player.y, current.x, current.y) <=
        maximumDistance * maximumDistance * 1.44
    ) {
      if (botSalvageTargetProgressing(player, brain, current, now)) return current;
      brain.ignoredSalvageId = current.id;
      brain.ignoredSalvageUntil = now + BOT_SALVAGE_IGNORE_MS;
      brain.strafeSign *= -1;
    }
    brain.salvageTargetId = null;
  }
  const claimed = botResourceClaims(player, "salvageTargetId", salvage);
  if (brain.ignoredSalvageId !== null && now < brain.ignoredSalvageUntil) {
    const ignored = salvage.find((item) => item.id === brain.ignoredSalvageId);
    if (ignored) claimed.push({ id: ignored.id, x: ignored.x, y: ignored.y });
  } else {
    brain.ignoredSalvageId = null;
  }
  const nearest = nearestUnclaimedResource(
    player.x,
    player.y,
    salvage,
    claimed,
    maximumDistance,
    BOT_SALVAGE_CLAIM_SEPARATION,
    (item) => botResourceInMiningLane(player.team, item),
  );
  brain.salvageTargetId = nearest?.id ?? null;
  if (nearest) {
    brain.asteroidTargetId = null;
    beginBotSalvageProgress(player, brain, nearest, now);
  }
  return nearest;
}

function beginBotSalvageProgress(
  player: PlayerState,
  brain: BotBrain,
  target: SalvageState,
  now: number,
): void {
  brain.salvageProgressTargetId = target.id;
  brain.salvageBestDistance = Math.hypot(target.x - player.x, target.y - player.y);
  brain.salvageLastProgressAt = now;
}

function botSalvageTargetProgressing(
  player: PlayerState,
  brain: BotBrain,
  target: SalvageState,
  now: number,
): boolean {
  if (brain.salvageProgressTargetId !== target.id) {
    beginBotSalvageProgress(player, brain, target, now);
    return true;
  }
  const distance = Math.hypot(target.x - player.x, target.y - player.y);
  if (distance + 18 < brain.salvageBestDistance) {
    brain.salvageBestDistance = distance;
    brain.salvageLastProgressAt = now;
  }
  return now - brain.salvageLastProgressAt <= BOT_SALVAGE_STALL_MS;
}

function nearestAsteroidForBot(
  player: PlayerState,
  maximumDistance: number,
): AsteroidState | undefined {
  const brain = player.bot;
  if (!brain) return undefined;
  if (brain.asteroidTargetId !== null) {
    const current = asteroids.find((asteroid) => asteroid.id === brain.asteroidTargetId);
    if (
      current &&
      botResourceInMiningLane(player.team, current) &&
      distanceSquared(player.x, player.y, current.x, current.y) <=
        maximumDistance * maximumDistance * 1.44
    ) {
      return current;
    }
    brain.asteroidTargetId = null;
  }
  const claimed = botResourceClaims(player, "asteroidTargetId", asteroids);
  const nearest = nearestUnclaimedResource(
    player.x,
    player.y,
    asteroids,
    claimed,
    maximumDistance,
    BOT_ASTEROID_CLAIM_SEPARATION,
    (asteroid) => botResourceInMiningLane(player.team, asteroid),
  );
  brain.asteroidTargetId = nearest?.id ?? null;
  if (nearest) brain.salvageTargetId = null;
  return nearest;
}

function botResourceInMiningLane(team: Team, resource: Pick<SalvageState, "x" | "y">): boolean {
  const base = motherships[team];
  const frontEdge =
    base.x + botLaunchDirection(team) * (base.width / 2 + BOT_MOTHERSHIP_RESOURCE_CLEARANCE);
  return team === "cyan" ? resource.x >= frontEdge : resource.x <= frontEdge;
}

function botResourceClaims<T extends { id: number; x: number; y: number }>(
  player: PlayerState,
  key: "salvageTargetId" | "asteroidTargetId",
  resources: readonly T[],
): BotResourceClaim[] {
  const claimed: BotResourceClaim[] = [];
  for (const teammate of players.values()) {
    if (
      teammate.id === player.id ||
      teammate.team !== player.team ||
      !teammate.alive ||
      !teammate.bot ||
      teammate.bot.mode !== "mine"
    ) {
      continue;
    }
    const targetId = teammate.bot[key];
    if (targetId === null) continue;
    const resource = resources.find((candidate) => candidate.id === targetId);
    if (resource) claimed.push({ id: resource.id, x: resource.x, y: resource.y });
  }
  return claimed;
}

function nearestUnclaimedResource<T extends { id: number; x: number; y: number }>(
  x: number,
  y: number,
  resources: readonly T[],
  claimed: readonly BotResourceClaim[],
  maximumDistance: number,
  claimSeparation = 0,
  eligible: (resource: T) => boolean = () => true,
): T | undefined {
  let nearest: T | undefined;
  let bestDistanceSquared = maximumDistance * maximumDistance;
  const separationSquared = claimSeparation * claimSeparation;
  for (const resource of resources) {
    if (!eligible(resource)) continue;
    if (
      claimed.some(
        (claim) =>
          claim.id === resource.id ||
          distanceSquared(claim.x, claim.y, resource.x, resource.y) < separationSquared,
      )
    ) {
      continue;
    }
    const candidateDistanceSquared = distanceSquared(x, y, resource.x, resource.y);
    if (candidateDistanceSquared < bestDistanceSquared) {
      nearest = resource;
      bestDistanceSquared = candidateDistanceSquared;
    }
  }
  return nearest;
}

function clearBotResourceTargets(brain: BotBrain): void {
  brain.salvageTargetId = null;
  brain.asteroidTargetId = null;
  brain.salvageProgressTargetId = null;
  brain.salvageBestDistance = Number.POSITIVE_INFINITY;
  brain.ignoredSalvageId = null;
  brain.ignoredSalvageUntil = 0;
}

function aimBotAt(
  player: PlayerState,
  target: { x: number; y: number; vx: number; vy: number },
  now: number,
  fire: boolean,
): void {
  const distance = Math.hypot(target.x - player.x, target.y - player.y);
  const bulletSpeed = Math.max(500, CLASS_CONFIG[player.shipClass].bulletSpeed);
  const travelSeconds = distance / bulletSpeed;
  const aimX = target.x + target.vx * travelSeconds * 0.65;
  const aimY = target.y + target.vy * travelSeconds * 0.65;
  const wobble =
    Math.sin(now * 0.004 + (player.bot?.serial ?? 0) * 1.7) * Math.min(0.08, distance / 8000);
  const angle = Math.atan2(aimY - player.y, aimX - player.x) + wobble;
  setBotAim(
    player,
    player.x + Math.cos(angle) * distance,
    player.y + Math.sin(angle) * distance,
    fire,
  );
}

function setBotMovement(
  player: PlayerState,
  targetX: number,
  targetY: number,
  stopDistance: number,
  strafe: boolean,
  strafeSign: number,
): void {
  const dx = targetX - player.x;
  const dy = targetY - player.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 0.001) {
    player.input.moveX = 0;
    player.input.moveY = 0;
    return;
  }
  const nx = dx / distance;
  const ny = dy / distance;
  const approach = distance > stopDistance + 55 ? 1 : distance < stopDistance - 35 ? -0.45 : 0;
  const strafeAmount = strafe && distance <= stopDistance + 160 ? 0.58 * strafeSign : 0;
  player.input.moveX = nx * approach - ny * strafeAmount;
  player.input.moveY = ny * approach + nx * strafeAmount;
}

function setBotAim(player: PlayerState, aimX: number, aimY: number, fire: boolean): void {
  player.input.aimX = aimX;
  player.input.aimY = aimY;
  player.input.fire = fire;
}

function setBotIntent(
  player: PlayerState,
  moveX: number,
  moveY: number,
  aimX: number,
  aimY: number,
  fire: boolean,
): void {
  player.input.moveX = moveX;
  player.input.moveY = moveY;
  setBotAim(player, aimX, aimY, fire);
}

function distanceToRect(x: number, y: number, base: MothershipState): number {
  const dx = Math.max(Math.abs(x - base.x) - base.width / 2, 0);
  const dy = Math.max(Math.abs(y - base.y) - base.height / 2, 0);
  return Math.hypot(dx, dy);
}

function handleAction(player: PlayerState, message: ActionMessage, now: number): void {
  if (!player.alive) {
    return;
  }
  if (message.action === "dock") {
    sendEvent(player.id, "Docking is automatic — fly inside your mothership", "info");
    return;
  }
  if (!player.docked) {
    sendEvent(player.id, "Fly inside your mothership first", "bad");
    return;
  }
  if (message.action === "repair") {
    repairPlayer(player);
  } else if (message.action === "repairMothership") {
    repairMothership(player);
  } else if (message.action === "upgradeClass") {
    upgradeClass(player, message.value, now);
  } else if (message.action === "upgradeStat") {
    upgradeStat(player, message.value);
  }
}

function depositCargo(player: PlayerState): void {
  if (player.cargo <= 0) {
    sendEvent(player.id, "Docked", "info");
    return;
  }
  const deposited = player.cargo;
  const personal = personalCargoValue(deposited);
  const contribution = deposited - personal;
  player.bank += personal;
  player.research = Math.min(65535, player.research + deposited);
  teamBank[player.team] += contribution;
  balanceMetrics.deposits[player.team] += 1;
  balanceMetrics.depositedSalvage[player.team] += deposited;
  sendEvent(
    player.id,
    `Banked ${personal} · research +${deposited} · team +${contribution}`,
    "good",
  );
  player.cargo = 0;
}

function personalCargoValue(cargo: number): number {
  if (cargo <= 0) return 0;
  return cargo - Math.max(1, Math.floor(cargo * 0.25));
}

function nextPlayerRepairCost(player: Pick<PlayerState, "hp" | "maxHp">): number {
  const repair = Math.min(32, Math.max(0, player.maxHp - player.hp));
  return Math.ceil(repair / 4);
}

function repairPlayer(player: PlayerState): void {
  const missing = player.maxHp - player.hp;
  if (missing <= 0.5) {
    sendEvent(player.id, "Ship already at full integrity", "info");
    return;
  }
  const repair = Math.min(32, missing);
  const cost = nextPlayerRepairCost(player);
  if (player.bank < cost) {
    sendEvent(player.id, `Repair needs ${cost} salvage`, "bad");
    return;
  }
  player.bank -= cost;
  player.hp = Math.min(player.maxHp, player.hp + repair);
  sendEvent(player.id, `Repaired ${Math.round(repair)} integrity`, "good");
}

function repairMothership(player: PlayerState): void {
  const base = motherships[player.team];
  const cost = 15;
  if (base.hp >= base.maxHp) {
    sendEvent(player.id, "Mothership already at full integrity", "info");
    return;
  }
  if (teamBank[player.team] < cost) {
    sendEvent(player.id, `Team reserve needs ${cost}`, "bad");
    return;
  }
  teamBank[player.team] -= cost;
  base.hp = Math.min(base.maxHp, base.hp + 120);
  sendEvent(player.id, "Mothership structure restored", "good");
}

function upgradeClass(player: PlayerState, shipClass: ShipClass, now: number): void {
  if (shipClass === player.shipClass) {
    return;
  }
  const cost = classUpgradeCost(player.shipClass, shipClass);
  const research = classResearchRequirement(player.shipClass, shipClass);
  if (cost === undefined) {
    sendEvent(player.id, "That transformation is outside your current branch", "bad");
    return;
  }
  if (research !== undefined && player.research < research) {
    sendEvent(player.id, `Transformation research ${player.research} / ${research}`, "bad");
    return;
  }
  if (player.bank < cost) {
    sendEvent(player.id, `Transformation needs ${cost} salvage`, "bad");
    return;
  }
  const oldMax = player.maxHp;
  const oldRatio = player.hp / Math.max(1, oldMax);
  player.bank -= cost;
  player.shipClass = shipClass;
  classMetrics(shipClass).picks += 1;
  balanceMetrics.firstTransform ??= milestone(player.team, now);
  player.maxHp = playerMaxHp(player);
  player.hp = Math.max(1, player.maxHp * oldRatio);
  player.nextFireAt = now + 250;
  sendEvent(player.id, `${shipClass.toUpperCase()} transformation complete`, "good");
}

function upgradeStat(player: PlayerState, stat: StatName): void {
  const level = player.stats[stat];
  if (level >= MAX_STAT_LEVEL) {
    sendEvent(player.id, `${stat.toUpperCase()} already maxed`, "info");
    return;
  }
  const cost = statCost(level);
  if (player.bank < cost) {
    sendEvent(player.id, `${stat.toUpperCase()} upgrade needs ${cost}`, "bad");
    return;
  }
  const oldMax = player.maxHp;
  player.bank -= cost;
  player.stats[stat] += 1;
  player.maxHp = playerMaxHp(player);
  if (stat === "hull") {
    player.hp += player.maxHp - oldMax;
  }
  sendEvent(player.id, `${stat.toUpperCase()} level ${player.stats[stat]}`, "good");
}

function update(dt: number, now: number): void {
  if (winner && now >= resetAt) {
    resetRound(now);
  }

  updateAsteroids(dt, now);
  updatePlayers(dt, now);
  updateProjectiles(dt, now);
  updateSalvage(dt);
  updateTurrets(now);
  if (!winner && now >= balanceMetrics.nextReportAt) {
    reportBalance(now, "interval");
    balanceMetrics.nextReportAt = now + BALANCE_REPORT_MS;
  }
}

function updatePlayers(dt: number, now: number): void {
  for (const player of players.values()) {
    player.dashing = player.dashUntil > now;
    if (!player.alive) {
      if (now >= player.respawnAt && !winner) {
        respawnPlayer(player);
      }
      continue;
    }

    player.maxHp = playerMaxHp(player);
    updateBotInput(player, now);
    const config = CLASS_CONFIG[player.shipClass];
    if (now - player.lastInputAt > 250) {
      player.input.moveX = 0;
      player.input.moveY = 0;
      player.input.fire = false;
    }
    const engineMultiplier = 1 + player.stats.engine * STAT_BONUSES.enginePerLevel;
    let moveX = player.input.moveX;
    let moveY = player.input.moveY;
    const magnitude = Math.hypot(moveX, moveY);
    if (magnitude > 1) {
      moveX /= magnitude;
      moveY /= magnitude;
    }
    player.vx += moveX * config.acceleration * engineMultiplier * dt;
    player.vy += moveY * config.acceleration * engineMultiplier * dt;
    const weapon = SHIP_WEAPONS[player.shipClass];
    const drag = Math.exp(-config.drag * dt * (player.dashing ? 0.25 : 1));
    player.vx *= drag;
    player.vy *= drag;
    const dashSpeed = Math.max(config.speed * 1.9, weapon.dashImpulse);
    const impactSpeedMultiplier = player.ramKnockbackUntil > now ? 1.8 : 1;
    const maxSpeed =
      (player.dashing ? dashSpeed : config.speed) * engineMultiplier * impactSpeedMultiplier;
    const speed = Math.hypot(player.vx, player.vy);
    if (speed > maxSpeed) {
      player.vx = (player.vx / speed) * maxSpeed;
      player.vy = (player.vy / speed) * maxSpeed;
    }

    const aimDx = player.input.aimX - player.x;
    const aimDy = player.input.aimY - player.y;
    if (Math.hypot(aimDx, aimDy) > 1) {
      player.angle = Math.atan2(aimDy, aimDx);
    }
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    const enemyBase = motherships[otherTeam(player.team)];
    const inMothershipRange = playerInMothershipThreat(player, enemyBase);
    if (inMothershipRange && player.mothershipThreatEnteredAt === null) {
      player.mothershipThreatEnteredAt = now;
    } else if (!inMothershipRange) {
      player.mothershipThreatEnteredAt = null;
    }

    if (player.dashing) {
      applyDashDamage(player, now);
    }
    for (const asteroid of asteroids) {
      resolveCircleCollision(player, asteroid.x, asteroid.y, asteroid.radius + config.radius);
    }
    resolveBaseCollision(player, motherships[otherTeam(player.team)], config.radius);

    const wasDocked = player.docked;
    player.docked = pointInsideBaseInterior(
      player.x,
      player.y,
      motherships[player.team],
      config.radius,
    );
    recordBotDockTransition(player, wasDocked);
    if (player.docked && !wasDocked) depositCargo(player);
    if (!player.docked && wasDocked) sendEvent(player.id, "Launch!", "info");

    const canFireWhileDocked = SHIP_WEAPONS[player.shipClass].mode === "dash";
    if (
      !winner &&
      (!player.docked || canFireWhileDocked) &&
      player.input.fire &&
      now >= player.nextFireAt
    ) {
      fireWeapon(player, now);
    }

    const pickupRadius = 27 + player.stats.mining * STAT_BONUSES.miningRadiusPerLevel;
    let collectedValue = 0;
    for (let index = salvage.length - 1; index >= 0; index -= 1) {
      const item = salvage[index];
      if (Math.hypot(player.x - item.x, player.y - item.y) <= pickupRadius) {
        player.cargo += item.value;
        collectedValue += item.value;
        salvage.splice(index, 1);
      }
    }
    if (collectedValue > 0) {
      sendEffect(player.id, {
        type: "effect",
        kind: "pickup",
        x: player.x,
        y: player.y,
        team: player.team,
        intensity: clamp(0.7 + collectedValue * 0.08, 0.7, 1.6),
      });
    }
  }
}

function recordBotDockTransition(player: PlayerState, wasDocked: boolean): void {
  if (!player.bot || player.docked === wasDocked) return;
  if (!player.docked) {
    balanceMetrics.botLaunches += 1;
    return;
  }
  balanceMetrics.botDockings += 1;
  const lowHull = player.hp / Math.max(1, player.maxHp) <= BOT_LOW_HULL_RATIO;
  if (lowHull && !botCanFundRepair(player)) balanceMetrics.botUnfundedDockings += 1;
}

function fireWeapon(player: PlayerState, now: number): void {
  const config = CLASS_CONFIG[player.shipClass];
  const weapon = SHIP_WEAPONS[player.shipClass];
  const cooldownMultiplier = 1 + player.stats.weapon * STAT_BONUSES.weaponRatePerLevel;
  player.nextFireAt = now + (config.cooldown * 1000) / cooldownMultiplier;
  const damageMultiplier = 1 + player.stats.weapon * STAT_BONUSES.weaponDamagePerLevel;
  const miningMultiplier = 1 + player.stats.mining * STAT_BONUSES.miningDamagePerLevel;

  if (weapon.mode === "dash") {
    player.dashUntil = now + weapon.dashDuration;
    player.dashHits.clear();
    player.vx += Math.cos(player.angle) * weapon.dashImpulse;
    player.vy += Math.sin(player.angle) * weapon.dashImpulse;
    return;
  }

  if (weapon.mode === "radial") {
    for (let index = 0; index < weapon.count; index += 1) {
      spawnProjectile(
        player,
        (Math.PI * 2 * index) / weapon.count,
        "bolt",
        config.bulletSpeed,
        config.damage * damageMultiplier,
        config.damage * miningMultiplier,
        now,
        1,
      );
    }
    return;
  }

  if (weapon.mode === "fan") {
    for (const offset of centeredOffsets(weapon.count, weapon.spread)) {
      spawnProjectile(
        player,
        player.angle + offset,
        "bolt",
        config.bulletSpeed,
        config.damage * damageMultiplier,
        config.damage * miningMultiplier,
        now,
        1,
      );
    }
    return;
  }

  if (weapon.mode === "drone") {
    for (const offset of centeredOffsets(weapon.count, weapon.spread)) {
      spawnProjectile(
        player,
        player.angle + offset,
        "drone",
        config.bulletSpeed,
        config.damage * damageMultiplier,
        config.damage * weapon.miningMultiplier * miningMultiplier,
        now,
        weapon.pierce,
      );
    }
    return;
  }

  if (weapon.mode === "fork") {
    for (const offset of centeredOffsets(weapon.count, weapon.spread)) {
      spawnProjectile(
        player,
        player.angle + offset,
        "needle",
        config.bulletSpeed,
        config.damage * damageMultiplier,
        config.damage * weapon.miningMultiplier * miningMultiplier,
        now,
        weapon.pierce,
      );
    }
    return;
  }

  const kind: ProjectileKind = weapon.mode === "rail" ? "needle" : "bolt";
  spawnProjectile(
    player,
    player.angle,
    kind,
    config.bulletSpeed,
    config.damage * damageMultiplier,
    config.damage * miningMultiplier,
    now,
    weapon.pierce,
  );
}

function centeredOffsets(count: number, spread: number): number[] {
  if (count <= 1) return [0];
  return Array.from({ length: count }, (_, index) => -spread / 2 + (spread * index) / (count - 1));
}

function spawnProjectile(
  player: PlayerState,
  angle: number,
  kind: ProjectileKind,
  speed: number,
  damage: number,
  asteroidDamage: number,
  now: number,
  pierce: number,
): void {
  const radius = kind === "needle" ? 4 : kind === "drone" ? 7 : 3;
  const offset = CLASS_CONFIG[player.shipClass].radius + radius + 2;
  projectiles.push({
    id: nextEntityId++,
    ownerId: player.id,
    team: player.team,
    x: player.x + Math.cos(angle) * offset,
    y: player.y + Math.sin(angle) * offset,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius,
    kind,
    damage,
    asteroidDamage,
    expiresAt: now + (kind === "drone" ? 1800 : 1350),
    pierce,
    createdAt: now,
    sourceClass: player.shipClass,
    rookieProtectedAtLaunch: rookieProtectionActive(player),
  });
  if (projectiles.length > MAX_PROJECTILES) {
    projectiles.splice(0, projectiles.length - MAX_PROJECTILES);
  }
}

function updateAsteroids(dt: number, now: number): void {
  for (const asteroid of asteroids) {
    asteroid.x += asteroid.vx * dt;
    asteroid.y += asteroid.vy * dt;
    for (const base of Object.values(motherships)) {
      resolveAsteroidBaseCollision(asteroid, base, now);
    }
    if (
      players.size > 0 &&
      !Array.from(players.values()).some(
        (player) => distanceSquared(player.x, player.y, asteroid.x, asteroid.y) < 36_000_000,
      ) &&
      !Object.values(motherships).some(
        (base) => distanceSquared(base.x, base.y, asteroid.x, asteroid.y) < 36_000_000,
      )
    ) {
      resetAsteroid(asteroid);
    }
  }
}

function updateProjectiles(dt: number, now: number): void {
  for (let index = projectiles.length - 1; index >= 0; index -= 1) {
    const projectile = projectiles[index];
    if (projectile.expiresAt <= now) {
      projectiles.splice(index, 1);
      continue;
    }
    if (projectile.kind === "drone") {
      steerDrone(projectile, dt);
    }
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;

    let hit = false;
    for (const asteroid of asteroids) {
      if (
        Math.hypot(projectile.x - asteroid.x, projectile.y - asteroid.y) <=
        asteroid.radius + projectile.radius
      ) {
        asteroid.hp -= projectile.asteroidDamage;
        if (projectile.kind === "turret") balanceMetrics.turretAsteroidHits += 1;
        projectile.pierce -= 1;
        hit = true;
        const broken = asteroid.hp <= 0;
        broadcastEffect({
          type: "effect",
          kind: broken ? "asteroidBreak" : "asteroidHit",
          x: projectile.x,
          y: projectile.y,
          team: projectile.team,
          intensity: broken ? Math.min(2.2, asteroid.radius / 26) : 0.65,
        });
        if (broken) {
          shatterAsteroid(asteroid);
        }
        break;
      }
    }

    if (!hit || projectile.pierce > 0) {
      for (const player of players.values()) {
        if (
          !player.alive ||
          player.docked ||
          player.team === projectile.team ||
          player.id === projectile.ownerId
        ) {
          continue;
        }
        const radius = CLASS_CONFIG[player.shipClass].radius;
        if (
          Math.hypot(projectile.x - player.x, projectile.y - player.y) <=
          radius + projectile.radius
        ) {
          if (rookiePvpDamageSuppressed(projectile, player)) {
            broadcastEffect({
              type: "effect",
              kind: "shipHit",
              x: projectile.x,
              y: projectile.y,
              team: player.team,
              intensity: 0.45,
            });
            projectile.pierce -= 1;
            hit = true;
            break;
          }
          const source: DamageSource =
            projectile.kind === "turret"
              ? { kind: "turret", team: projectile.team }
              : {
                  kind: "player",
                  playerId: projectile.ownerId,
                  team: projectile.team,
                  shipClass: projectile.sourceClass ?? "scout",
                };
          const impactDamage =
            projectile.kind === "turret"
              ? mothershipTurretDamage(player, projectile.damage)
              : projectile.damage;
          const destroyed = damagePlayer(player, impactDamage, now, source);
          if (projectile.kind === "turret") {
            balanceMetrics.turretFlightMs += now - projectile.createdAt;
          }
          broadcastEffect({
            type: "effect",
            kind: destroyed ? "shipBreak" : "shipHit",
            x: projectile.x,
            y: projectile.y,
            team: player.team,
            intensity: destroyed ? 1.8 : 1,
          });
          projectile.pierce -= 1;
          hit = true;
          break;
        }
      }
    }

    const enemyBase = motherships[otherTeam(projectile.team)];
    if (
      (!hit || projectile.pierce > 0) &&
      pointInExpandedRect(projectile.x, projectile.y, enemyBase, projectile.radius)
    ) {
      damageMothership(
        enemyBase,
        projectile.damage,
        now,
        projectile.sourceClass
          ? {
              kind: "player",
              playerId: projectile.ownerId,
              team: projectile.team,
              shipClass: projectile.sourceClass,
            }
          : { kind: "environment" },
      );
      broadcastEffect({
        type: "effect",
        kind: "baseHit",
        x: projectile.x,
        y: projectile.y,
        team: enemyBase.team,
        intensity: projectile.kind === "needle" ? 1.4 : 0.85,
      });
      projectile.pierce = 0;
      hit = true;
    }

    if (hit && projectile.pierce <= 0) {
      projectiles.splice(index, 1);
    }
  }
}

function steerDrone(projectile: ProjectileState, dt: number): void {
  let targetX = 0;
  let targetY = 0;
  let best = 380;
  for (const player of players.values()) {
    if (!player.alive || player.docked || player.team === projectile.team) {
      continue;
    }
    const distance = Math.hypot(projectile.x - player.x, projectile.y - player.y);
    if (distance < best) {
      best = distance;
      targetX = player.x;
      targetY = player.y;
    }
  }
  if (best === 380) {
    for (const asteroid of asteroids) {
      const distance = Math.hypot(projectile.x - asteroid.x, projectile.y - asteroid.y);
      if (distance < best) {
        best = distance;
        targetX = asteroid.x;
        targetY = asteroid.y;
      }
    }
  }
  if (best < 380) {
    const speed = Math.hypot(projectile.vx, projectile.vy);
    const desired = Math.atan2(targetY - projectile.y, targetX - projectile.x);
    const current = Math.atan2(projectile.vy, projectile.vx);
    const angle = current + normalizeAngle(desired - current) * Math.min(1, dt * 4.2);
    projectile.vx = Math.cos(angle) * speed;
    projectile.vy = Math.sin(angle) * speed;
  }
}

function shatterAsteroid(asteroid: AsteroidState): void {
  const fragments = Math.max(3, Math.round(asteroid.radius / 11));
  const baseValue = 3 + Math.floor(asteroid.radius / 14);
  const fragmentValue = Math.max(
    1,
    Math.round(baseValue * ASTEROID_KIND_CONFIG[asteroid.kind].salvageMultiplier),
  );
  for (let index = 0; index < fragments; index += 1) {
    const angle = (Math.PI * 2 * index) / fragments + Math.random() * 0.5;
    const speed = 25 + Math.random() * 45;
    salvage.push({
      id: nextEntityId++,
      x: asteroid.x + Math.cos(angle) * asteroid.radius * 0.35,
      y: asteroid.y + Math.sin(angle) * asteroid.radius * 0.35,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      value: fragmentValue,
    });
  }
  if (salvage.length > MAX_SALVAGE) {
    salvage.splice(0, salvage.length - MAX_SALVAGE);
  }
  resetAsteroid(asteroid);
}

function updateSalvage(dt: number): void {
  for (const item of salvage) {
    const magnet = nearestSalvageMagnet(item);
    if (magnet) {
      const dx = magnet.x - item.x;
      const dy = magnet.y - item.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0) {
        const level = magnet.stats.mining;
        const pull = miningMagnetPull(level);
        const desiredVx = magnet.vx * pull.velocityInheritance + (dx / distance) * pull.speed;
        const desiredVy = magnet.vy * pull.velocityInheritance + (dy / distance) * pull.speed;
        const response = 1 - Math.exp(-pull.response * dt);
        item.vx += (desiredVx - item.vx) * response;
        item.vy += (desiredVy - item.vy) * response;
      }
    }
    item.x += item.vx * dt;
    item.y += item.vy * dt;
    const drag = Math.exp(-(magnet ? 0.35 : 1.8) * dt);
    item.vx *= drag;
    item.vy *= drag;
  }
}

function nearestSalvageMagnet(item: SalvageState): PlayerState | undefined {
  let nearest: PlayerState | undefined;
  let nearestDistanceSquared = Infinity;
  for (const player of players.values()) {
    if (!player.alive || player.docked || player.stats.mining <= 0) continue;
    const radius = miningMagnetRadius(player.stats.mining);
    const candidateDistanceSquared = distanceSquared(item.x, item.y, player.x, player.y);
    if (
      candidateDistanceSquared <= radius * radius &&
      candidateDistanceSquared < nearestDistanceSquared
    ) {
      nearest = player;
      nearestDistanceSquared = candidateDistanceSquared;
    }
  }
  return nearest;
}

type RamImpactSource = Pick<PlayerState, "x" | "y" | "angle" | "shipClass">;

function ramImpactHitsCircle(
  attacker: RamImpactSource,
  targetX: number,
  targetY: number,
  targetRadius: number,
): boolean {
  const impact = RAM_IMPACT_PROFILES[attacker.shipClass];
  const config = CLASS_CONFIG[attacker.shipClass];
  if (!impact) return false;
  if (impact.arcRadius <= 0) {
    return (
      Math.hypot(attacker.x - targetX, attacker.y - targetY) <=
      config.radius + impact.reachBonus + targetRadius
    );
  }

  const cosine = Math.cos(attacker.angle);
  const sine = Math.sin(attacker.angle);
  const centerX = attacker.x + cosine * impact.arcOffset;
  const centerY = attacker.y + sine * impact.arcOffset;
  const dx = targetX - centerX;
  const dy = targetY - centerY;
  const forward = dx * cosine + dy * sine;
  const lateral = Math.abs(-dx * sine + dy * cosine);
  if (forward >= 0) {
    return Math.hypot(forward, lateral) <= impact.arcRadius + targetRadius;
  }
  const lateralOverflow = Math.max(0, lateral - impact.arcRadius);
  return Math.hypot(forward, lateralOverflow) <= targetRadius;
}

function ramImpactHitsBase(attacker: RamImpactSource, base: MothershipState): boolean {
  const impact = RAM_IMPACT_PROFILES[attacker.shipClass];
  if (!impact) return false;
  if (impact.arcRadius <= 0) {
    return pointInExpandedRect(attacker.x, attacker.y, base, 28 + impact.reachBonus);
  }

  const cosine = Math.cos(attacker.angle);
  const sine = Math.sin(attacker.angle);
  const centerX = attacker.x + cosine * impact.arcOffset;
  const centerY = attacker.y + sine * impact.arcOffset;
  const corners = [
    [base.x - base.width / 2, base.y - base.height / 2],
    [base.x + base.width / 2, base.y - base.height / 2],
    [base.x + base.width / 2, base.y + base.height / 2],
    [base.x - base.width / 2, base.y + base.height / 2],
  ].map(([x, y]) => {
    const dx = x - centerX;
    const dy = y - centerY;
    return { forward: dx * cosine + dy * sine, lateral: -dx * sine + dy * cosine };
  });
  for (let index = 0; index < corners.length; index += 1) {
    if (
      segmentIntersectsForwardHalfDisk(
        corners[index],
        corners[(index + 1) % corners.length],
        impact.arcRadius,
      )
    ) {
      return true;
    }
  }
  return (
    centerX >= base.x - base.width / 2 &&
    centerX <= base.x + base.width / 2 &&
    centerY >= base.y - base.height / 2 &&
    centerY <= base.y + base.height / 2
  );
}

function segmentIntersectsForwardHalfDisk(
  start: { forward: number; lateral: number },
  end: { forward: number; lateral: number },
  radius: number,
): boolean {
  let startForward = start.forward;
  let startLateral = start.lateral;
  let endForward = end.forward;
  let endLateral = end.lateral;
  if (startForward < 0 && endForward < 0) return false;
  if (startForward < 0 || endForward < 0) {
    const ratio = startForward / (startForward - endForward);
    const intersectionLateral = startLateral + (endLateral - startLateral) * ratio;
    if (startForward < 0) {
      startForward = 0;
      startLateral = intersectionLateral;
    } else {
      endForward = 0;
      endLateral = intersectionLateral;
    }
  }
  const deltaForward = endForward - startForward;
  const deltaLateral = endLateral - startLateral;
  const lengthSquared = deltaForward * deltaForward + deltaLateral * deltaLateral;
  const closestRatio =
    lengthSquared > 0
      ? Math.max(
          0,
          Math.min(1, -(startForward * deltaForward + startLateral * deltaLateral) / lengthSquared),
        )
      : 0;
  const closestForward = startForward + deltaForward * closestRatio;
  const closestLateral = startLateral + deltaLateral * closestRatio;
  return Math.hypot(closestForward, closestLateral) <= radius;
}

function applyDashDamage(player: PlayerState, now: number): void {
  const config = CLASS_CONFIG[player.shipClass];
  const weapon = SHIP_WEAPONS[player.shipClass];
  const impact = RAM_IMPACT_PROFILES[player.shipClass];
  if (!impact) return;
  const damage = config.damage * (1 + player.stats.weapon * STAT_BONUSES.weaponDamagePerLevel);
  const asteroidDamage =
    config.damage *
    weapon.miningMultiplier *
    (1 + player.stats.mining * STAT_BONUSES.miningDamagePerLevel);
  const attackerProtected = rookieProtectionActive(player);
  for (const asteroid of asteroids) {
    const hitKey = `asteroid-${asteroid.id}`;
    if (
      player.dashHits.has(hitKey) ||
      !ramImpactHitsCircle(player, asteroid.x, asteroid.y, asteroid.radius)
    ) {
      continue;
    }
    player.dashHits.add(hitKey);
    asteroid.hp -= asteroidDamage;
    const broken = asteroid.hp <= 0;
    broadcastEffect({
      type: "effect",
      kind: broken ? "asteroidBreak" : "asteroidHit",
      x: asteroid.x,
      y: asteroid.y,
      team: player.team,
      intensity: broken
        ? Math.max(impact.effectIntensity, Math.min(2.4, asteroid.radius / 24))
        : impact.effectIntensity,
    });
    if (broken) {
      shatterAsteroid(asteroid);
    } else {
      asteroid.vx += Math.cos(player.angle) * impact.knockback * 0.35;
      asteroid.vy += Math.sin(player.angle) * impact.knockback * 0.35;
    }
  }
  for (const target of players.values()) {
    if (
      !target.alive ||
      target.docked ||
      target.team === player.team ||
      attackerProtected ||
      rookieProtectionActive(target) ||
      player.dashHits.has(target.id)
    ) {
      continue;
    }
    if (ramImpactHitsCircle(player, target.x, target.y, CLASS_CONFIG[target.shipClass].radius)) {
      player.dashHits.add(target.id);
      target.vx += Math.cos(player.angle) * impact.knockback;
      target.vy += Math.sin(player.angle) * impact.knockback;
      target.ramKnockbackUntil = Math.max(
        target.ramKnockbackUntil,
        now + RAM_KNOCKBACK_DURATION_MS,
      );
      const destroyed = damagePlayer(target, damage, now, {
        kind: "player",
        playerId: player.id,
        team: player.team,
        shipClass: player.shipClass,
      });
      broadcastEffect({
        type: "effect",
        kind: destroyed ? "shipBreak" : "dashHit",
        x: target.x,
        y: target.y,
        team: target.team,
        intensity: destroyed ? Math.max(2.4, impact.effectIntensity) : impact.effectIntensity,
      });
    }
  }
  const enemyBase = motherships[otherTeam(player.team)];
  if (!player.dashHits.has(`base-${enemyBase.team}`) && ramImpactHitsBase(player, enemyBase)) {
    player.dashHits.add(`base-${enemyBase.team}`);
    damageMothership(enemyBase, damage * 1.2, now, {
      kind: "player",
      playerId: player.id,
      team: player.team,
      shipClass: player.shipClass,
    });
    broadcastEffect({
      type: "effect",
      kind: "dashHit",
      x: player.x,
      y: player.y,
      team: enemyBase.team,
      intensity: 1.8,
    });
    player.dashUntil = now;
  }
}

function damagePlayer(
  player: PlayerState,
  damage: number,
  now: number,
  source: DamageSource,
): boolean {
  const appliedDamage = Math.min(player.hp, damage);
  player.hp -= damage;
  if (source.kind === "player") {
    classMetrics(source.shipClass).playerDamage += appliedDamage;
  } else if (source.kind === "turret") {
    balanceMetrics.turretHits += 1;
    if (player.mothershipThreatEnteredAt !== null) {
      balanceMetrics.turretWarningMs += now - player.mothershipThreatEnteredAt;
      balanceMetrics.turretWarningSamples += 1;
    }
  }
  if (player.hp <= 0) {
    destroyPlayer(player, now, source);
    return true;
  }
  return false;
}

function destroyPlayer(player: PlayerState, now: number, source: DamageSource): void {
  player.alive = false;
  player.docked = false;
  player.hp = 0;
  player.respawnAt = now + RESPAWN_DELAY_MS;
  player.vx = 0;
  player.vy = 0;
  player.mothershipThreatEnteredAt = null;
  if (player.bot) clearBotResourceTargets(player.bot);
  classMetrics(player.shipClass).deaths += 1;
  const droppedResources = player.cargo + killBounty(player);
  if (source.kind === "player" && source.team !== player.team) {
    balanceMetrics.playerKills[source.team] += 1;
    balanceMetrics.firstKill ??= milestone(source.team, now);
    classMetrics(source.shipClass).kills += 1;
  } else if (source.kind === "turret") {
    balanceMetrics.turretKills += 1;
  }
  spawnSalvageBurst(player.x, player.y, droppedResources, player.team);
  player.cargo = 0;
  const loss = applyDeathLevelLoss(player);
  sendEvent(
    player.id,
    `Ship lost · ${loss.frameLevels} frame + ${loss.statLevels} stat levels lost · ${droppedResources} resources exposed`,
    "bad",
  );
}

function applyDeathLevelLoss(player: PlayerState): { frameLevels: number; statLevels: number } {
  const previousClass = previousShipClass(player.shipClass);
  const frameLevels = previousClass ? 1 : 0;
  if (previousClass) player.shipClass = previousClass;

  let statLevels = 0;
  const statOrder: readonly StatName[] = ["weapon", "engine", "hull", "mining"];
  for (let lost = 0; lost < DEATH_STAT_LEVELS_LOST; lost += 1) {
    let highest: StatName | undefined;
    for (const stat of statOrder) {
      if (player.stats[stat] > 0 && (!highest || player.stats[stat] > player.stats[highest])) {
        highest = stat;
      }
    }
    if (!highest) break;
    player.stats[highest] -= 1;
    statLevels += 1;
  }
  player.maxHp = playerMaxHp(player);
  return { frameLevels, statLevels };
}

function respawnPlayer(player: PlayerState): void {
  const spawn = spawnPoint(player.team);
  player.alive = true;
  player.hp = playerMaxHp(player);
  player.maxHp = player.hp;
  player.x = spawn.x;
  player.y = spawn.y;
  player.vx = 0;
  player.vy = 0;
  player.angle = player.team === "cyan" ? 0 : Math.PI;
  player.dashUntil = 0;
  player.ramKnockbackUntil = 0;
  player.docked = true;
  player.mothershipThreatEnteredAt = null;
}

function updateTurrets(now: number): void {
  if (winner) return;
  for (const base of Object.values(motherships)) {
    if (now < base.nextVolleyAt) continue;
    for (let cannonIndex = 0; cannonIndex < MOTHERSHIP_TURRET_MOUNTS.length; cannonIndex += 1) {
      if (now < base.nextTurretAt[cannonIndex]) continue;
      const mount = MOTHERSHIP_TURRET_MOUNTS[cannonIndex];
      const x = base.x + mount.xFactor * base.width + mount.normalX * 12;
      const y = base.y + mount.yFactor * base.height + mount.normalY * 12;
      let target: { x: number; y: number; vx: number; vy: number } | undefined;
      let targetKind: "player" | "asteroid" | undefined;
      let bestDistance = MOTHERSHIP_PLAYER_TARGET_RANGE;

      for (const player of players.values()) {
        if (
          !player.alive ||
          player.docked ||
          player.team === base.team ||
          player.mothershipThreatEnteredAt === null ||
          now - player.mothershipThreatEnteredAt < MOTHERSHIP_LOCK_ON_MS
        ) {
          continue;
        }
        if (!isOutsideTurretArc(x, y, mount.normalX, mount.normalY, player.x, player.y)) continue;
        const distance = Math.hypot(x - player.x, y - player.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          target = player;
          targetKind = "player";
        }
      }

      if (!target) {
        bestDistance = MOTHERSHIP_ASTEROID_TARGET_RANGE;
        for (const asteroid of asteroids) {
          if (!isOutsideTurretArc(x, y, mount.normalX, mount.normalY, asteroid.x, asteroid.y)) {
            continue;
          }
          const distance = Math.hypot(x - asteroid.x, y - asteroid.y);
          const closingOnBase =
            (base.x - asteroid.x) * asteroid.vx + (base.y - asteroid.y) * asteroid.vy > 0;
          const immediateThreat = pointInExpandedRect(
            asteroid.x,
            asteroid.y,
            base,
            MOTHERSHIP_IMMEDIATE_DEFENSE_MARGIN,
          );
          if (
            !immediateThreat &&
            (!closingOnBase || distance > MOTHERSHIP_ASTEROID_DEFENSE_RADIUS)
          ) {
            continue;
          }
          if (distance < bestDistance) {
            bestDistance = distance;
            target = asteroid;
            targetKind = "asteroid";
          }
        }
      }

      if (!target || !targetKind) continue;
      const bulletSpeed = MOTHERSHIP_TURRET_PROJECTILE_SPEED;
      const travelSeconds = bestDistance / bulletSpeed;
      let aimX = target.x + target.vx * travelSeconds * 0.7;
      let aimY = target.y + target.vy * travelSeconds * 0.7;
      if (!isOutsideTurretArc(x, y, mount.normalX, mount.normalY, aimX, aimY)) {
        aimX = target.x;
        aimY = target.y;
      }
      const angle = Math.atan2(aimY - y, aimX - x);
      projectiles.push({
        id: nextEntityId++,
        ownerId: `base-${base.team}`,
        team: base.team,
        x: x + Math.cos(angle) * 20,
        y: y + Math.sin(angle) * 20,
        vx: Math.cos(angle) * bulletSpeed,
        vy: Math.sin(angle) * bulletSpeed,
        radius: 5,
        kind: "turret",
        damage: MOTHERSHIP_TURRET_MIN_PLAYER_DAMAGE,
        asteroidDamage: MOTHERSHIP_TURRET_ASTEROID_DAMAGE,
        expiresAt: now + 2200,
        pierce: 1,
        createdAt: now,
      });
      balanceMetrics.turretShots += 1;
      base.nextTurretAt[cannonIndex] = now + MOTHERSHIP_TURRET_RELOAD_MS;
      base.nextVolleyAt =
        now +
        (targetKind === "player" ? MOTHERSHIP_PLAYER_VOLLEY_MS : MOTHERSHIP_ASTEROID_VOLLEY_MS);
      break;
    }
    if (projectiles.length > MAX_PROJECTILES) {
      projectiles.splice(0, projectiles.length - MAX_PROJECTILES);
    }
  }
}

function declareWinner(team: Team, now: number): void {
  if (winner) {
    return;
  }
  winner = team;
  resetAt = now + 8000;
  reportBalance(now, "final", team);
  broadcastEvent(`${team.toUpperCase()} mothership victory`, "good");
}

function resetRound(now: number): void {
  winner = null;
  resetAt = 0;
  balanceMetrics = createBalanceMetrics(now);
  projectiles = [];
  salvage = [];
  asteroids = Array.from({ length: ASTEROID_COUNT }, (_, index) => makeAsteroid(index + 1));
  teamBank.cyan = 0;
  teamBank.magenta = 0;
  for (const base of Object.values(motherships)) {
    base.hp = base.maxHp;
    base.nextTurretAt = MOTHERSHIP_TURRET_MOUNTS.map((_, index) => now + 700 + index * 70);
    base.nextVolleyAt = now + 700;
  }
  for (const player of players.values()) {
    const spawn = spawnPoint(player.team);
    player.x = spawn.x;
    player.y = spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.shipClass = "scout";
    player.stats = emptyStats();
    player.maxHp = CLASS_CONFIG.scout.maxHp;
    player.hp = player.maxHp;
    player.cargo = 0;
    player.bank = 0;
    player.research = 0;
    player.alive = true;
    player.docked = true;
    player.respawnAt = 0;
    player.dashUntil = 0;
    player.ramKnockbackUntil = 0;
    player.mothershipThreatEnteredAt = null;
    player.angle = player.team === "cyan" ? 0 : Math.PI;
    if (player.bot) {
      player.bot.mode = "mine";
      player.bot.nextDecisionAt = now;
      player.bot.attackUntil = 0;
      player.bot.nextAttackAt = now + 35_000 + (player.bot.serial % 4) * 5000;
      player.bot.launchUntil = now + BOT_LAUNCH_COMMIT_MS;
      clearBotResourceTargets(player.bot);
    }
    classMetrics("scout").picks += 1;
  }
  if (now > 0) {
    broadcastEvent("New extraction cycle", "info");
  }
}

function makeAsteroid(id: number): AsteroidState {
  const home: AsteroidState["home"] = id % 3 === 0 ? "cyan" : id % 3 === 1 ? "magenta" : "center";
  const asteroid: AsteroidState = {
    id,
    kind: "rock",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: 0,
    hp: 0,
    maxHp: 0,
    seed: 0,
    nextMothershipImpactAt: 0,
    home,
  };
  resetAsteroid(asteroid);
  return asteroid;
}

function resetAsteroid(asteroid: AsteroidState): void {
  const center = asteroidHomeAnchor(asteroid);
  const centerField = asteroid.home === "center";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const spawnAngle = Math.random() * Math.PI * 2;
    const spawnDistance =
      (centerField ? CENTER_ASTEROID_SPAWN_MIN_DISTANCE : ASTEROID_SPAWN_MIN_DISTANCE) +
      Math.random() *
        (centerField ? CENTER_ASTEROID_SPAWN_DISTANCE_RANGE : ASTEROID_SPAWN_DISTANCE_RANGE);
    asteroid.x = center.x + Math.cos(spawnAngle) * spawnDistance;
    asteroid.y = center.y + Math.sin(spawnAngle) * spawnDistance;
    if (
      !Object.values(motherships).some((base) =>
        pointInExpandedRect(asteroid.x, asteroid.y, base, ASTEROID_MOTHERSHIP_SPAWN_MARGIN),
      )
    ) {
      break;
    }
  }
  asteroid.kind = asteroidKindForRoll(asteroid.home, Math.random());
  const config = ASTEROID_KIND_CONFIG[asteroid.kind];
  const direction = Math.random() * Math.PI * 2;
  const speed = (18 + Math.random() * 54) * config.speedMultiplier;
  asteroid.vx = Math.cos(direction) * speed;
  asteroid.vy = Math.sin(direction) * speed;
  asteroid.radius = config.minimumRadius + Math.random() * config.radiusRange;
  asteroid.maxHp = asteroid.radius * config.hpPerRadius;
  asteroid.hp = asteroid.maxHp;
  asteroid.seed = Math.floor(Math.random() * 100000);
  asteroid.nextMothershipImpactAt = 0;
}

function asteroidHomeAnchor(asteroid: Pick<AsteroidState, "home">): { x: number; y: number } {
  return asteroid.home === "center"
    ? { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 }
    : motherships[asteroid.home];
}

function asteroidKindForRoll(home: AsteroidHome, roll: number): AsteroidKind {
  const thresholds = home === "center" ? CENTER_ASTEROID_KINDS : BASE_ASTEROID_KINDS;
  const safeRoll = Math.max(0, Math.min(0.999999, roll));
  return thresholds.find((threshold) => safeRoll < threshold.maximumRoll)?.kind ?? "rock";
}

function expectedAsteroidSalvageMultiplier(home: AsteroidHome): number {
  const thresholds = home === "center" ? CENTER_ASTEROID_KINDS : BASE_ASTEROID_KINDS;
  let previous = 0;
  let expected = 0;
  for (const threshold of thresholds) {
    expected +=
      (threshold.maximumRoll - previous) * ASTEROID_KIND_CONFIG[threshold.kind].salvageMultiplier;
    previous = threshold.maximumRoll;
  }
  return expected;
}

function createBalanceMetrics(now: number): RoundBalanceMetrics {
  return {
    startedAt: now,
    nextReportAt: now + BALANCE_REPORT_MS,
    deposits: { cyan: 0, magenta: 0 },
    depositedSalvage: { cyan: 0, magenta: 0 },
    playerKills: { cyan: 0, magenta: 0 },
    playerBaseDamage: { cyan: 0, magenta: 0 },
    asteroidBaseDamage: { cyan: 0, magenta: 0 },
    turretShots: 0,
    turretAsteroidHits: 0,
    turretHits: 0,
    turretKills: 0,
    turretWarningMs: 0,
    turretWarningSamples: 0,
    turretFlightMs: 0,
    botDockings: 0,
    botLaunches: 0,
    botUnfundedDockings: 0,
    firstTransform: null,
    firstKill: null,
    firstPlayerBaseDamage: null,
    classes: {},
  };
}

function classMetrics(shipClass: ShipClass): ClassBalanceMetrics {
  const current = balanceMetrics.classes[shipClass];
  if (current) return current;
  const created: ClassBalanceMetrics = {
    picks: 0,
    playerDamage: 0,
    baseDamage: 0,
    kills: 0,
    deaths: 0,
  };
  balanceMetrics.classes[shipClass] = created;
  return created;
}

function milestone(team: Team, now: number): BalanceMilestone {
  return {
    team,
    elapsedSeconds: rounded((now - balanceMetrics.startedAt) / 1000),
  };
}

function reportBalance(now: number, reason: "interval" | "final", winningTeam?: Team): void {
  const classes: Record<string, ClassBalanceMetrics> = {};
  for (const shipClass of Object.keys(balanceMetrics.classes) as ShipClass[]) {
    const value = balanceMetrics.classes[shipClass];
    if (!value) continue;
    classes[shipClass] = {
      picks: value.picks,
      playerDamage: rounded(value.playerDamage),
      baseDamage: rounded(value.baseDamage),
      kills: value.kills,
      deaths: value.deaths,
    };
  }
  const turretWarningMs =
    balanceMetrics.turretWarningSamples > 0
      ? rounded(balanceMetrics.turretWarningMs / balanceMetrics.turretWarningSamples)
      : null;
  const turretFlightMs =
    balanceMetrics.turretHits > 0
      ? rounded(balanceMetrics.turretFlightMs / balanceMetrics.turretHits)
      : null;
  console.info(
    `[balance] ${JSON.stringify({
      reason,
      winningTeam: winningTeam ?? null,
      elapsedSeconds: rounded((now - balanceMetrics.startedAt) / 1000),
      connectedPlayers: players.size,
      deposits: balanceMetrics.deposits,
      depositedSalvage: balanceMetrics.depositedSalvage,
      playerKills: balanceMetrics.playerKills,
      playerBaseDamage: roundedTeamValues(balanceMetrics.playerBaseDamage),
      asteroidBaseDamage: roundedTeamValues(balanceMetrics.asteroidBaseDamage),
      firstTransform: balanceMetrics.firstTransform,
      firstKill: balanceMetrics.firstKill,
      firstPlayerBaseDamage: balanceMetrics.firstPlayerBaseDamage,
      turrets: {
        shots: balanceMetrics.turretShots,
        asteroidHits: balanceMetrics.turretAsteroidHits,
        hits: balanceMetrics.turretHits,
        kills: balanceMetrics.turretKills,
        averageWarningToHitMs: turretWarningMs,
        averageFlightMs: turretFlightMs,
      },
      bots: {
        dockings: balanceMetrics.botDockings,
        launches: balanceMetrics.botLaunches,
        unfundedDockings: balanceMetrics.botUnfundedDockings,
      },
      classes,
    })}`,
  );
}

function killBounty(player: PlayerState): number {
  const statLevels = Object.values(player.stats).reduce((total, level) => total + level, 0);
  return (
    KILL_BOUNTY_BASE +
    shipTransformTier(player.shipClass) * KILL_BOUNTY_PER_TIER +
    statLevels * KILL_BOUNTY_PER_STAT
  );
}

function roundedTeamValues(values: Record<Team, number>): Record<Team, number> {
  return { cyan: rounded(values.cyan), magenta: rounded(values.magenta) };
}

function validateBalanceTuning(): void {
  if (
    asteroidKindForRoll("cyan", 0.999) !== "crystal" ||
    asteroidKindForRoll("center", 0.999) !== "core" ||
    expectedAsteroidSalvageMultiplier("center") < expectedAsteroidSalvageMultiplier("cyan") * 1.3
  ) {
    throw new Error("Center asteroid value progression regression");
  }
  const coordinatedTarget = nearestUnclaimedResource(
    0,
    0,
    [
      { id: 1, x: 10, y: 0 },
      { id: 2, x: 20, y: 0 },
      { id: 3, x: 80, y: 0 },
    ],
    [{ id: 1, x: 10, y: 0 }],
    100,
    40,
  );
  if (coordinatedTarget?.id !== 3) {
    throw new Error("Bot resource reservation regression");
  }
  const cyanFront =
    motherships.cyan.x + motherships.cyan.width / 2 + BOT_MOTHERSHIP_RESOURCE_CLEARANCE;
  const magentaFront =
    motherships.magenta.x - motherships.magenta.width / 2 - BOT_MOTHERSHIP_RESOURCE_CLEARANCE;
  if (
    botLaunchDirection("cyan") !== 1 ||
    botLaunchDirection("magenta") !== -1 ||
    !botResourceInMiningLane("cyan", { x: cyanFront, y: motherships.cyan.y }) ||
    botResourceInMiningLane("cyan", { x: cyanFront - 1, y: motherships.cyan.y }) ||
    !botResourceInMiningLane("magenta", { x: magentaFront, y: motherships.magenta.y }) ||
    botResourceInMiningLane("magenta", { x: magentaFront + 1, y: motherships.magenta.y })
  ) {
    throw new Error("Bot mothership launch lane regression");
  }
  const damagedBot = { hp: 40, maxHp: 100, bank: 0, cargo: 0 };
  if (
    botCanFundRepair(damagedBot) ||
    botCanFundRepair({ ...damagedBot, cargo: 8 }) ||
    !botCanFundRepair({ ...damagedBot, cargo: 11 }) ||
    !botCanFundRepair({ ...damagedBot, bank: 8 })
  ) {
    throw new Error("Bot repair funding regression");
  }
  const rookie = {
    team: "cyan" as const,
    x: motherships.cyan.x + motherships.cyan.width / 2 + ROOKIE_SECTOR_MARGIN,
    y: motherships.cyan.y,
    shipClass: "needle" as const,
  };
  if (
    !rookieProtectionActive(rookie) ||
    rookieProtectionActive({ ...rookie, x: rookie.x + 1 }) ||
    rookieProtectionActive({ ...rookie, shipClass: "lance" }) ||
    rookieProtectionActive({ ...rookie, team: "magenta" })
  ) {
    throw new Error("Rookie sector boundary regression");
  }
  const outsideRookie = { ...rookie, x: rookie.x + 1 };
  if (
    !rookiePvpDamageSuppressed({ kind: "bolt", rookieProtectedAtLaunch: false }, rookie) ||
    !rookiePvpDamageSuppressed({ kind: "bolt", rookieProtectedAtLaunch: true }, outsideRookie) ||
    rookiePvpDamageSuppressed({ kind: "bolt", rookieProtectedAtLaunch: false }, outsideRookie) ||
    rookiePvpDamageSuppressed({ kind: "turret", rookieProtectedAtLaunch: true }, rookie)
  ) {
    throw new Error("Rookie PVP suppression regression");
  }
  const minimumMagnetPull = miningMagnetPull(1);
  const maximumMagnetPull = miningMagnetPull(MAX_STAT_LEVEL);
  if (
    miningMagnetRadius(0) !== 0 ||
    miningMagnetRadius(1) < 140 ||
    miningMagnetRadius(MAX_STAT_LEVEL) < 400 ||
    minimumMagnetPull.speed >= maximumMagnetPull.speed ||
    maximumMagnetPull.speed !== 440 ||
    Math.abs(maximumMagnetPull.response - 5.8) > 0.0001 ||
    Math.abs(maximumMagnetPull.velocityInheritance - 0.4) > 0.0001
  ) {
    throw new Error("Mining magnet progression regression");
  }
  const apexRam: RamImpactSource = { x: 0, y: 0, angle: 0, shipClass: "behemoth" };
  const starterRam: RamImpactSource = { x: 0, y: 0, angle: 0, shipClass: "ram" };
  if (
    !ramImpactHitsCircle(apexRam, 60, 80, 10) ||
    !ramImpactHitsCircle(apexRam, 130, 0, 10) ||
    ramImpactHitsCircle(apexRam, -40, 0, 10) ||
    !ramImpactHitsCircle(starterRam, 54, 0, 10)
  ) {
    throw new Error("Ram impact geometry regression");
  }
  const testScout: Pick<PlayerState, "shipClass" | "maxHp"> = {
    shipClass: "scout",
    maxHp: CLASS_CONFIG.scout.maxHp * (1 + MAX_STAT_LEVEL * STAT_BONUSES.hullPerLevel),
  };
  if (mothershipTurretDamage(testScout, MOTHERSHIP_TURRET_MIN_PLAYER_DAMAGE) <= testScout.maxHp) {
    throw new Error("Mothership defense must destroy every starter frame in one hit");
  }
  for (const shipClass of Object.keys(CLASS_CONFIG) as ShipClass[]) {
    if (shipTransformTier(shipClass) !== 4) continue;
    const baseHp = CLASS_CONFIG[shipClass].maxHp;
    const unarmoredTarget = { shipClass, maxHp: baseHp };
    const fullHullTarget = {
      shipClass,
      maxHp: baseHp * (1 + MAX_STAT_LEVEL * STAT_BONUSES.hullPerLevel),
    };
    const damage = mothershipTurretDamage(fullHullTarget, MOTHERSHIP_TURRET_MIN_PLAYER_DAMAGE);
    const unarmoredExposureSeconds = focusedFireSurvivalSeconds(unarmoredTarget, damage);
    const fullHullExposureSeconds = focusedFireSurvivalSeconds(fullHullTarget, damage);
    if (
      fullHullExposureSeconds < APEX_MIN_SIEGE_SECONDS ||
      fullHullExposureSeconds > APEX_MAX_SIEGE_SECONDS ||
      fullHullExposureSeconds <= unarmoredExposureSeconds
    ) {
      throw new Error(`${shipClass} apex siege window is outside its target`);
    }
  }
  if (
    MOTHERSHIP_LOCK_ON_MS > 250 ||
    MOTHERSHIP_PLAYER_VOLLEY_MS < 450 ||
    MOTHERSHIP_PLAYER_VOLLEY_MS > 600 ||
    MOTHERSHIP_TURRET_PROJECTILE_SPEED < 1500
  ) {
    throw new Error("Mothership defense timing regression");
  }
}

function mothershipTurretDamage(
  target: Pick<PlayerState, "shipClass" | "maxHp">,
  minimumEvolvedFrameDamage: number,
): number {
  const tier = shipTransformTier(target.shipClass);
  if (tier === 0) return target.maxHp + 1;
  return Math.max(
    minimumEvolvedFrameDamage,
    CLASS_CONFIG[target.shipClass].maxHp * MOTHERSHIP_TURRET_DAMAGE_FRACTION_BY_TIER[tier],
  );
}

function focusedFireSurvivalSeconds(
  target: Pick<PlayerState, "maxHp">,
  damagePerHit: number,
): number {
  const lethalHits = Math.ceil(target.maxHp / damagePerHit);
  return ((lethalHits - 1) * MOTHERSHIP_PLAYER_VOLLEY_MS) / 1000;
}

function spawnSalvageBurst(x: number, y: number, totalValue: number, team?: Team): void {
  let remaining = Math.max(0, Math.round(totalValue));
  const drops = Math.min(10, Math.max(2, Math.ceil(remaining / 7)));
  for (let index = 0; index < drops && remaining > 0; index += 1) {
    const value = Math.max(1, Math.ceil(remaining / (drops - index)));
    remaining -= value;
    const angle = Math.random() * Math.PI * 2;
    salvage.push({
      id: nextEntityId++,
      x,
      y,
      vx: Math.cos(angle) * (35 + Math.random() * 45),
      vy: Math.sin(angle) * (35 + Math.random() * 45),
      value,
      team,
    });
  }
  if (salvage.length > MAX_SALVAGE) {
    salvage.splice(0, salvage.length - MAX_SALVAGE);
  }
}

function damageMothership(
  base: MothershipState,
  damage: number,
  now: number,
  source: DamageSource,
): void {
  const appliedDamage = Math.min(base.hp, Math.max(0, damage));
  if (appliedDamage <= 0) return;
  base.hp -= appliedDamage;
  if (source.kind === "player") {
    balanceMetrics.playerBaseDamage[source.team] += appliedDamage;
    balanceMetrics.firstPlayerBaseDamage ??= milestone(source.team, now);
    classMetrics(source.shipClass).baseDamage += appliedDamage;
  } else if (source.kind === "environment") {
    balanceMetrics.asteroidBaseDamage[base.team] += appliedDamage;
  }
  if (base.hp <= 0) {
    base.hp = 0;
    broadcastEffect({
      type: "effect",
      kind: "baseBreak",
      x: base.x,
      y: base.y,
      team: base.team,
      intensity: 5.5,
    });
    declareWinner(source.kind === "player" ? source.team : otherTeam(base.team), now);
  }
}

function sendSnapshots(now: number): void {
  const allShips = Array.from(
    players.values(),
    (player): ShipView => ({
      id: String(player.wireId),
      name: player.name,
      team: player.team,
      x: rounded(player.x),
      y: rounded(player.y),
      vx: rounded(player.vx),
      vy: rounded(player.vy),
      angle: rounded(player.angle),
      hp: rounded(player.hp),
      maxHp: rounded(player.maxHp),
      cargo: player.cargo,
      bank: player.bank,
      research: player.research,
      shipClass: player.shipClass,
      stats: { ...player.stats },
      docked: player.docked,
      alive: player.alive,
      respawnIn: player.alive ? 0 : Math.max(0, rounded((player.respawnAt - now) / 1000)),
      dashing: player.dashUntil > now,
    }),
  );
  const allAsteroids = asteroids.map(
    (asteroid): AsteroidView => ({
      id: asteroid.id,
      kind: asteroid.kind,
      x: rounded(asteroid.x),
      y: rounded(asteroid.y),
      vx: rounded(asteroid.vx),
      vy: rounded(asteroid.vy),
      radius: rounded(asteroid.radius),
      hp: rounded(asteroid.hp),
      maxHp: rounded(asteroid.maxHp),
      seed: asteroid.seed,
    }),
  );
  const allProjectiles = projectiles.map(
    (projectile): ProjectileView => ({
      id: projectile.id,
      ownerId: projectileOwnerWireId(projectile.ownerId),
      team: projectile.team,
      x: rounded(projectile.x),
      y: rounded(projectile.y),
      vx: rounded(projectile.vx),
      vy: rounded(projectile.vy),
      radius: projectile.radius,
      kind: projectile.kind,
    }),
  );
  const snapshotBase = {
    type: "snapshot" as const,
    sequence: nextSnapshotSequence++,
    serverTime: now,
    motherships: Object.values(motherships).map(
      (base): MothershipView => ({
        team: base.team,
        x: base.x,
        y: base.y,
        width: base.width,
        height: base.height,
        hp: rounded(base.hp),
        maxHp: base.maxHp,
      }),
    ),
    teamBank: { ...teamBank },
    winner,
    resetIn: winner ? Math.max(0, rounded((resetAt - now) / 1000)) : 0,
  };

  for (const connection of server.connections) {
    const focus = players.get(connection.id);
    if (!focus) {
      continue;
    }
    const interestRadius = INTEREST_RADIUS + shipTransformTier(focus.shipClass) * 180;
    const nearby = (x: number, y: number, radius = interestRadius): boolean =>
      Math.hypot(x - focus.x, y - focus.y) <= radius;
    const snapshot: SnapshotMessage = {
      ...snapshotBase,
      selfId: String(focus.wireId),
      ships: allShips
        .filter((ship) => ship.id === String(focus.wireId) || nearby(ship.x, ship.y))
        .sort((a, b) =>
          a.id === String(focus.wireId)
            ? -1
            : b.id === String(focus.wireId)
              ? 1
              : distanceSquared(a.x, a.y, focus.x, focus.y) -
                distanceSquared(b.x, b.y, focus.x, focus.y),
        )
        .slice(0, MAX_SNAPSHOT_SHIPS),
      asteroids: allAsteroids
        .filter((asteroid) => nearby(asteroid.x, asteroid.y))
        .sort(
          (a, b) =>
            distanceSquared(a.x, a.y, focus.x, focus.y) -
            distanceSquared(b.x, b.y, focus.x, focus.y),
        )
        .slice(0, MAX_SNAPSHOT_ASTEROIDS),
      salvage: [],
      projectiles: allProjectiles
        .filter((projectile) => nearby(projectile.x, projectile.y, interestRadius + 300))
        .sort(
          (a, b) =>
            distanceSquared(a.x, a.y, focus.x, focus.y) -
            distanceSquared(b.x, b.y, focus.x, focus.y),
        )
        .slice(0, MAX_SNAPSHOT_PROJECTILES),
    };
    const bytes = encodeSnapshot(snapshot);
    if (bytes.byteLength > DATAGRAM_BUDGET_BYTES) throw new Error("Snapshot budget regression");
    server.datagrams.send(connection.id, bytes);
  }
}

function sendSalvageSnapshots(): void {
  const sequence = nextSalvageSequence++;
  const visibilityRadiusSquared = SALVAGE_VISIBILITY_RADIUS * SALVAGE_VISIBILITY_RADIUS;
  for (const connection of server.connections) {
    const focus = players.get(connection.id);
    if (!focus) continue;
    const visible = salvage
      .filter(
        (item) => distanceSquared(item.x, item.y, focus.x, focus.y) <= visibilityRadiusSquared,
      )
      .sort(
        (a, b) =>
          distanceSquared(a.x, a.y, focus.x, focus.y) - distanceSquared(b.x, b.y, focus.x, focus.y),
      )
      .slice(0, MAX_SALVAGE_PACKET_ITEMS)
      .map(
        (item): SalvageView => ({
          id: item.id,
          x: rounded(item.x),
          y: rounded(item.y),
          value: item.value,
          team: item.team,
        }),
      );
    const bytes = encodeSalvageSnapshot({ type: "salvageSnapshot", sequence, salvage: visible });
    if (bytes.byteLength > DATAGRAM_BUDGET_BYTES) {
      throw new Error("Salvage snapshot budget regression");
    }
    server.datagrams.send(connection.id, bytes);
  }
}

function sendEvent(connectionId: string, text: string, tone: EventMessage["tone"]): void {
  if (players.get(connectionId)?.bot) return;
  const message: EventMessage = { type: "event", text, tone };
  server.streams.send(connectionId, encodeEvent(message));
}

function broadcastEvent(text: string, tone: EventMessage["tone"]): void {
  const message: EventMessage = { type: "event", text, tone };
  server.streams.broadcast(encodeEvent(message));
}

function broadcastEffect(message: Omit<EffectMessage, "id">): void {
  const effect: EffectMessage = { ...message, id: nextEffectId++ };
  const recipients = server.connections
    .filter((connection) => {
      const player = players.get(connection.id);
      return (
        player && Math.hypot(player.x - effect.x, player.y - effect.y) <= INTEREST_RADIUS + 400
      );
    })
    .map((connection) => connection.id);
  if (recipients.length > 0) {
    const bytes = encodeEffect(effect);
    if (effect.kind === "baseBreak") {
      for (const connectionId of recipients) server.streams.send(connectionId, bytes);
    } else {
      server.datagrams.broadcast(bytes, { only: recipients });
    }
  }
}

function sendEffect(connectionId: string, message: Omit<EffectMessage, "id">): void {
  if (players.get(connectionId)?.bot) return;
  server.datagrams.send(connectionId, encodeEffect({ ...message, id: nextEffectId++ }));
}

function distanceSquared(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function isOutsideTurretArc(
  turretX: number,
  turretY: number,
  normalX: number,
  normalY: number,
  targetX: number,
  targetY: number,
): boolean {
  return (targetX - turretX) * normalX + (targetY - turretY) * normalY > 4;
}

function playerInMothershipThreat(player: PlayerState, base: MothershipState): boolean {
  for (const mount of MOTHERSHIP_TURRET_MOUNTS) {
    const turretX = base.x + mount.xFactor * base.width + mount.normalX * 12;
    const turretY = base.y + mount.yFactor * base.height + mount.normalY * 12;
    if (
      isOutsideTurretArc(turretX, turretY, mount.normalX, mount.normalY, player.x, player.y) &&
      distanceSquared(turretX, turretY, player.x, player.y) <
        MOTHERSHIP_PLAYER_TARGET_RANGE * MOTHERSHIP_PLAYER_TARGET_RANGE
    ) {
      return true;
    }
  }
  return false;
}

function rookieProtectionActive(
  player: Pick<PlayerState, "team" | "x" | "y" | "shipClass">,
): boolean {
  return (
    shipTransformTier(player.shipClass) <= ROOKIE_PROTECTED_MAX_TIER &&
    pointInExpandedRect(player.x, player.y, motherships[player.team], ROOKIE_SECTOR_MARGIN)
  );
}

function rookiePvpDamageSuppressed(
  projectile: Pick<ProjectileState, "kind" | "rookieProtectedAtLaunch">,
  target: Pick<PlayerState, "team" | "x" | "y" | "shipClass">,
): boolean {
  return (
    projectile.kind !== "turret" &&
    (projectile.rookieProtectedAtLaunch === true || rookieProtectionActive(target))
  );
}

function projectileOwnerWireId(ownerId: string): string {
  const owner = players.get(ownerId);
  return owner ? String(owner.wireId) : "turret";
}

function resolveCircleCollision(
  player: PlayerState,
  x: number,
  y: number,
  minimumDistance: number,
): void {
  const dx = player.x - x;
  const dy = player.y - y;
  const distance = Math.hypot(dx, dy);
  if (distance >= minimumDistance || distance === 0) {
    return;
  }
  const nx = dx / distance;
  const ny = dy / distance;
  const push = minimumDistance - distance;
  player.x += nx * push;
  player.y += ny * push;
  const outwardSpeed = player.vx * nx + player.vy * ny;
  if (outwardSpeed < 0) {
    player.vx -= outwardSpeed * nx * 1.5;
    player.vy -= outwardSpeed * ny * 1.5;
  }
}

function resolveBaseCollision(player: PlayerState, base: MothershipState, radius: number): void {
  if (!pointInExpandedRect(player.x, player.y, base, radius)) {
    return;
  }
  const left = base.x - base.width / 2 - radius;
  const right = base.x + base.width / 2 + radius;
  const top = base.y - base.height / 2 - radius;
  const bottom = base.y + base.height / 2 + radius;
  const distances = [
    { value: Math.abs(player.x - left), x: left, y: player.y },
    { value: Math.abs(player.x - right), x: right, y: player.y },
    { value: Math.abs(player.y - top), x: player.x, y: top },
    { value: Math.abs(player.y - bottom), x: player.x, y: bottom },
  ];
  distances.sort((a, b) => a.value - b.value);
  player.x = distances[0].x;
  player.y = distances[0].y;
  player.vx *= -0.25;
  player.vy *= -0.25;
}

function resolveAsteroidBaseCollision(
  asteroid: AsteroidState,
  base: MothershipState,
  now: number,
): void {
  const left = base.x - base.width / 2;
  const right = base.x + base.width / 2;
  const top = base.y - base.height / 2;
  const bottom = base.y + base.height / 2;
  const closestX = clamp(asteroid.x, left, right);
  const closestY = clamp(asteroid.y, top, bottom);
  const dx = asteroid.x - closestX;
  const dy = asteroid.y - closestY;
  const distance = Math.hypot(dx, dy);
  if (distance >= asteroid.radius) return;

  let nx: number;
  let ny: number;
  if (distance > 0) {
    nx = dx / distance;
    ny = dy / distance;
    asteroid.x += nx * (asteroid.radius - distance + 0.5);
    asteroid.y += ny * (asteroid.radius - distance + 0.5);
  } else {
    const exits = [
      { distance: asteroid.x - left, nx: -1, ny: 0, x: left - asteroid.radius, y: asteroid.y },
      { distance: right - asteroid.x, nx: 1, ny: 0, x: right + asteroid.radius, y: asteroid.y },
      { distance: asteroid.y - top, nx: 0, ny: -1, x: asteroid.x, y: top - asteroid.radius },
      { distance: bottom - asteroid.y, nx: 0, ny: 1, x: asteroid.x, y: bottom + asteroid.radius },
    ].sort((a, b) => a.distance - b.distance);
    const exit = exits[0];
    nx = exit.nx;
    ny = exit.ny;
    asteroid.x = exit.x;
    asteroid.y = exit.y;
  }

  const normalSpeed = asteroid.vx * nx + asteroid.vy * ny;
  if (normalSpeed >= 0) return;
  const impactSpeed = -normalSpeed;
  asteroid.vx -= normalSpeed * nx * 1.82;
  asteroid.vy -= normalSpeed * ny * 1.82;
  if (impactSpeed < 8 || now < asteroid.nextMothershipImpactAt) return;

  asteroid.nextMothershipImpactAt = now + 350;
  const damage = clamp(asteroid.radius * impactSpeed * 0.018, 6, 70);
  damageMothership(base, damage, now, { kind: "environment" });
  broadcastEffect({
    type: "effect",
    kind: "baseHit",
    x: asteroid.x - nx * asteroid.radius,
    y: asteroid.y - ny * asteroid.radius,
    team: base.team,
    intensity: clamp(damage / 24, 0.7, 2.4),
  });
}

function pointInExpandedRect(
  x: number,
  y: number,
  base: MothershipState,
  expansion: number,
): boolean {
  return (
    x >= base.x - base.width / 2 - expansion &&
    x <= base.x + base.width / 2 + expansion &&
    y >= base.y - base.height / 2 - expansion &&
    y <= base.y + base.height / 2 + expansion
  );
}

function pointInsideBaseInterior(
  x: number,
  y: number,
  base: MothershipState,
  radius: number,
): boolean {
  return (
    x >= base.x - base.width / 2 + radius &&
    x <= base.x + base.width / 2 - radius &&
    y >= base.y - base.height / 2 + radius &&
    y <= base.y + base.height / 2 - radius
  );
}

function spawnPoint(team: Team): { x: number; y: number } {
  const base = motherships[team];
  return {
    x: base.x,
    y: base.y + (Math.random() - 0.5) * (base.height - 180),
  };
}

function playerMaxHp(player: PlayerState): number {
  return CLASS_CONFIG[player.shipClass].maxHp * (1 + player.stats.hull * STAT_BONUSES.hullPerLevel);
}

function otherTeam(team: Team): Team {
  return team === "cyan" ? "magenta" : "cyan";
}

function normalizeAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
