import { server, type Connection } from "snack:server";
import {
  MAX_STAT_LEVEL,
  MOTHERSHIP_HEIGHT,
  MOTHERSHIP_LOCK_ON_MS,
  MOTHERSHIP_MAX_HP,
  MOTHERSHIP_PLAYER_TARGET_RANGE,
  MOTHERSHIP_TURRET_MOUNTS,
  MOTHERSHIP_WIDTH,
  MOTHERSHIP_X_INSET,
  SHIP_PHYSICS,
  SHIP_WEAPONS,
  STAT_BONUSES,
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
const MOTHERSHIP_ASTEROID_DEFENSE_RADIUS = 950;
const MOTHERSHIP_IMMEDIATE_DEFENSE_MARGIN = 420;
const MOTHERSHIP_ASTEROID_TARGET_RANGE = 1500;
const MOTHERSHIP_TURRET_PROJECTILE_SPEED = 1650;
const MOTHERSHIP_TURRET_MIN_PLAYER_DAMAGE = 8;
const MOTHERSHIP_TURRET_DAMAGE_FRACTION_BY_TIER = [1, 0.32, 0.2, 0.12, 0.06] as const;
const MOTHERSHIP_TURRET_ASTEROID_DAMAGE = 60;
const MOTHERSHIP_TURRET_RELOAD_MS = 650;
const MOTHERSHIP_PLAYER_VOLLEY_MS = 500;
const MOTHERSHIP_ASTEROID_VOLLEY_MS = 220;
const RESPAWN_DELAY_MS = 4000;
const APEX_MIN_SIEGE_SECONDS = 8;
const MAX_PROJECTILES = 180;
const MAX_SALVAGE = MAX_SALVAGE_PACKET_ITEMS;
const SALVAGE_VISIBILITY_RADIUS = 3200;
const DEATH_STAT_LEVELS_LOST = 2;
const BALANCE_REPORT_MS = 60_000;
const KILL_BOUNTY_BASE = 6;
const KILL_BOUNTY_PER_TIER = 12;
const KILL_BOUNTY_PER_STAT = 2;

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
  input: ControlState;
  lastInputAt: number;
  nextFireAt: number;
  respawnAt: number;
  dashUntil: number;
  dashHits: Set<string>;
  mothershipThreatEnteredAt: number | null;
}

interface MothershipState extends MothershipView {
  nextTurretAt: number[];
  nextVolleyAt: number;
}

interface AsteroidState extends AsteroidView {
  nextMothershipImpactAt: number;
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
let winner: Team | null = null;
let resetAt = 0;
let balanceMetrics = createBalanceMetrics(0);

export async function main(): Promise<void> {
  validateBalanceTuning();
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
  for (const id of players.keys()) {
    if (!live.has(id)) {
      players.delete(id);
      rosterChanged = true;
    }
  }

  for (const connection of server.connections) {
    if (!players.has(connection.id)) {
      const team = smallerTeam();
      const player = createPlayer(connection, team, now);
      players.set(connection.id, player);
      classMetrics("scout").picks += 1;
      server.streams.send(
        connection.id,
        encodeIdentities(
          Array.from(players.values(), ({ wireId, name }) => ({ id: wireId, name })),
          true,
        ),
      );
      server.streams.broadcast(encodeIdentities([{ id: player.wireId, name: player.name }]));
      sendEvent(connection.id, `Joined ${team.toUpperCase()} team`, "good");
    }
  }
  if (rosterChanged) broadcastIdentities();
}

function smallerTeam(): Team {
  let cyan = 0;
  let magenta = 0;
  for (const player of players.values()) {
    if (player.team === "cyan") {
      cyan += 1;
    } else {
      magenta += 1;
    }
  }
  return cyan <= magenta ? "cyan" : "magenta";
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
  const spawn = spawnPoint(team);
  const stats = emptyStats();
  return {
    id: connection.id,
    wireId: allocateWireId(),
    name: connection.userName.slice(0, 24),
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
    mothershipThreatEnteredAt: null,
  };
}

function emptyStats(): ShipStats {
  return { weapon: 0, engine: 0, hull: 0, mining: 0 };
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
  const contribution = Math.max(1, Math.floor(deposited * 0.25));
  const personal = deposited - contribution;
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

function repairPlayer(player: PlayerState): void {
  const missing = player.maxHp - player.hp;
  if (missing <= 0.5) {
    sendEvent(player.id, "Ship already at full integrity", "info");
    return;
  }
  const repair = Math.min(32, missing);
  const cost = Math.ceil(repair / 4);
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
    const maxSpeed = (player.dashing ? dashSpeed : config.speed) * engineMultiplier;
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
      resetAsteroid(asteroid, randomPlayer());
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
  for (let index = 0; index < fragments; index += 1) {
    const angle = (Math.PI * 2 * index) / fragments + Math.random() * 0.5;
    const speed = 25 + Math.random() * 45;
    salvage.push({
      id: nextEntityId++,
      x: asteroid.x + Math.cos(angle) * asteroid.radius * 0.35,
      y: asteroid.y + Math.sin(angle) * asteroid.radius * 0.35,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      value: 3 + Math.floor(asteroid.radius / 14),
    });
  }
  if (salvage.length > MAX_SALVAGE) {
    salvage.splice(0, salvage.length - MAX_SALVAGE);
  }
  resetAsteroid(asteroid);
}

function updateSalvage(dt: number): void {
  for (const item of salvage) {
    item.x += item.vx * dt;
    item.y += item.vy * dt;
    const drag = Math.exp(-1.8 * dt);
    item.vx *= drag;
    item.vy *= drag;
  }
}

function applyDashDamage(player: PlayerState, now: number): void {
  const config = CLASS_CONFIG[player.shipClass];
  const weapon = SHIP_WEAPONS[player.shipClass];
  const damage = config.damage * (1 + player.stats.weapon * STAT_BONUSES.weaponDamagePerLevel);
  const asteroidDamage =
    config.damage *
    weapon.miningMultiplier *
    (1 + player.stats.mining * STAT_BONUSES.miningDamagePerLevel);
  for (const asteroid of asteroids) {
    const hitKey = `asteroid-${asteroid.id}`;
    if (
      player.dashHits.has(hitKey) ||
      Math.hypot(player.x - asteroid.x, player.y - asteroid.y) > asteroid.radius + config.radius + 2
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
      intensity: broken ? Math.min(2.4, asteroid.radius / 24) : 1.2,
    });
    if (broken) {
      shatterAsteroid(asteroid);
    } else {
      asteroid.vx += Math.cos(player.angle) * 85;
      asteroid.vy += Math.sin(player.angle) * 85;
    }
  }
  for (const target of players.values()) {
    if (
      !target.alive ||
      target.docked ||
      target.team === player.team ||
      player.dashHits.has(target.id)
    ) {
      continue;
    }
    const radius = CLASS_CONFIG[target.shipClass].radius + config.radius;
    if (Math.hypot(player.x - target.x, player.y - target.y) <= radius) {
      player.dashHits.add(target.id);
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
        intensity: destroyed ? 2 : 1.5,
      });
    }
  }
  const enemyBase = motherships[otherTeam(player.team)];
  if (
    !player.dashHits.has(`base-${enemyBase.team}`) &&
    pointInExpandedRect(player.x, player.y, enemyBase, 28)
  ) {
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
    player.mothershipThreatEnteredAt = null;
    player.angle = player.team === "cyan" ? 0 : Math.PI;
    classMetrics("scout").picks += 1;
  }
  if (now > 0) {
    broadcastEvent("New extraction cycle", "info");
  }
}

function makeAsteroid(id: number): AsteroidState {
  const asteroid: AsteroidState = {
    id,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: 0,
    hp: 0,
    maxHp: 0,
    seed: 0,
    nextMothershipImpactAt: 0,
  };
  const anchor =
    id % 3 === 0
      ? motherships.cyan
      : id % 3 === 1
        ? motherships.magenta
        : { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
  resetAsteroid(asteroid, anchor);
  return asteroid;
}

function resetAsteroid(
  asteroid: AsteroidState,
  anchor: { x: number; y: number } | undefined = randomPlayer(),
): void {
  const center = anchor ?? { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const spawnAngle = Math.random() * Math.PI * 2;
    const spawnDistance =
      ASTEROID_SPAWN_MIN_DISTANCE + Math.random() * ASTEROID_SPAWN_DISTANCE_RANGE;
    asteroid.x = center.x + Math.cos(spawnAngle) * spawnDistance;
    asteroid.y = center.y + Math.sin(spawnAngle) * spawnDistance;
    if (
      !Object.values(motherships).some((base) =>
        pointInExpandedRect(asteroid.x, asteroid.y, base, 360),
      )
    ) {
      break;
    }
  }
  const direction = Math.random() * Math.PI * 2;
  const speed = 18 + Math.random() * 54;
  asteroid.vx = Math.cos(direction) * speed;
  asteroid.vy = Math.sin(direction) * speed;
  asteroid.radius = 27 + Math.random() * 35;
  asteroid.maxHp = asteroid.radius * 2.4;
  asteroid.hp = asteroid.maxHp;
  asteroid.seed = Math.floor(Math.random() * 100000);
  asteroid.nextMothershipImpactAt = 0;
}

function randomPlayer(): PlayerState | undefined {
  if (players.size === 0) return undefined;
  const candidates = Array.from(players.values());
  return candidates[Math.floor(Math.random() * candidates.length)];
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
  const testScout: Pick<PlayerState, "shipClass" | "maxHp"> = {
    shipClass: "scout",
    maxHp: CLASS_CONFIG.scout.maxHp * (1 + MAX_STAT_LEVEL * STAT_BONUSES.hullPerLevel),
  };
  if (mothershipTurretDamage(testScout, MOTHERSHIP_TURRET_MIN_PLAYER_DAMAGE) <= testScout.maxHp) {
    throw new Error("Mothership defense must destroy every starter frame in one hit");
  }
  for (const shipClass of Object.keys(CLASS_CONFIG) as ShipClass[]) {
    if (shipTransformTier(shipClass) !== 4) continue;
    const target = { shipClass, maxHp: CLASS_CONFIG[shipClass].maxHp };
    const damage = mothershipTurretDamage(target, MOTHERSHIP_TURRET_MIN_PLAYER_DAMAGE);
    const lethalHits = Math.ceil(target.maxHp / damage);
    const minimumExposureSeconds = ((lethalHits - 1) * MOTHERSHIP_PLAYER_VOLLEY_MS) / 1000;
    if (minimumExposureSeconds < APEX_MIN_SIEGE_SECONDS) {
      throw new Error(`${shipClass} apex siege window is too short`);
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
    target.maxHp * MOTHERSHIP_TURRET_DAMAGE_FRACTION_BY_TIER[tier],
  );
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
    server.datagrams.broadcast(encodeEffect(effect), { only: recipients });
  }
}

function sendEffect(connectionId: string, message: Omit<EffectMessage, "id">): void {
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
