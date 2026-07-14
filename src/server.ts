import { server, type Connection, type NetworkMessage } from "snack:server";
import {
  CLASS_COST,
  MAX_STAT_LEVEL,
  SHIP_PHYSICS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  statCost,
  type ActionMessage,
  type AsteroidView,
  type EventMessage,
  type EffectMessage,
  type InputMessage,
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

const TICK_MS = 16;
const SNAPSHOT_MS = 33;
const ASTEROID_COUNT = 68;
const INTEREST_RADIUS = 1650;
const MAX_PROJECTILES = 180;
const MAX_SALVAGE = 90;
const PORT_Y = [-220, 0, 220];

interface ControlState {
  sequence: number;
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fire: boolean;
}

interface PlayerState extends ShipView {
  input: ControlState;
  nextFireAt: number;
  respawnAt: number;
  dockedPort: number;
  dashUntil: number;
  dashHits: Set<string>;
}

interface MothershipState extends MothershipView {
  nextTurretAt: number;
}

interface AsteroidState extends AsteroidView {}

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
}

const CLASS_CONFIG = SHIP_PHYSICS;

const players = new Map<string, PlayerState>();
const motherships: Record<Team, MothershipState> = {
  cyan: {
    team: "cyan",
    x: 190,
    y: WORLD_HEIGHT / 2,
    width: 180,
    height: 720,
    hp: 1800,
    maxHp: 1800,
    nextTurretAt: 0,
  },
  magenta: {
    team: "magenta",
    x: WORLD_WIDTH - 190,
    y: WORLD_HEIGHT / 2,
    width: 180,
    height: 720,
    hp: 1800,
    maxHp: 1800,
    nextTurretAt: 0,
  },
};
const teamBank: Record<Team, number> = { cyan: 0, magenta: 0 };
let asteroids: AsteroidState[] = [];
let salvage: SalvageState[] = [];
let projectiles: ProjectileState[] = [];
let nextEntityId = 1;
let winner: Team | null = null;
let resetAt = 0;

export async function main(): Promise<void> {
  resetRound(0);
  let lastTick = server.elapsedMs();
  let lastSnapshot = 0;

  while (server.running) {
    const now = server.elapsedMs();
    const dt = Math.min(0.05, Math.max(0.001, (now - lastTick) / 1000));
    lastTick = now;

    syncConnections(now);
    for (const event of server.datagrams.drain()) {
      handleMessage(event.connection, event.json<unknown>(), now);
    }

    update(dt, now);
    if (now - lastSnapshot >= SNAPSHOT_MS) {
      sendSnapshots(now);
      lastSnapshot = now;
    }

    await server.sleep(TICK_MS);
  }
}

function syncConnections(now: number): void {
  const live = new Set(server.connections.map((connection) => connection.id));
  for (const id of players.keys()) {
    if (!live.has(id)) {
      players.delete(id);
    }
  }

  for (const connection of server.connections) {
    if (!players.has(connection.id)) {
      const team = smallerTeam();
      players.set(connection.id, createPlayer(connection, team, now));
      sendEvent(connection.id, `Joined ${team.toUpperCase()} team`, "good");
    }
  }
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

function createPlayer(connection: Connection, team: Team, now: number): PlayerState {
  const spawn = spawnPoint(team);
  const stats = emptyStats();
  return {
    id: connection.id,
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
    shipClass: "scout",
    stats,
    docked: false,
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
    respawnAt: 0,
    dockedPort: 1,
    dashUntil: 0,
    dashHits: new Set<string>(),
  };
}

function emptyStats(): ShipStats {
  return { weapon: 0, engine: 0, hull: 0, mining: 0 };
}

function handleMessage(connection: Connection, message: unknown, now: number): void {
  const player = players.get(connection.id);
  if (!player || !isRecord(message) || typeof message.type !== "string") {
    return;
  }

  if (message.type === "input") {
    const input = parseInput(message);
    if (input && input.sequence >= player.input.sequence) {
      player.input = input;
    }
    return;
  }

  if (message.type === "action") {
    const action = parseAction(message);
    if (action) {
      handleAction(player, action, now);
    }
  }
}

function parseInput(message: Record<string, unknown>): InputMessage | undefined {
  if (
    typeof message.sequence !== "number" ||
    typeof message.moveX !== "number" ||
    typeof message.moveY !== "number" ||
    typeof message.aimX !== "number" ||
    typeof message.aimY !== "number" ||
    typeof message.fire !== "boolean" ||
    !Number.isFinite(message.sequence) ||
    !Number.isFinite(message.moveX) ||
    !Number.isFinite(message.moveY) ||
    !Number.isFinite(message.aimX) ||
    !Number.isFinite(message.aimY)
  ) {
    return undefined;
  }
  return {
    type: "input",
    sequence: Math.floor(message.sequence),
    moveX: clamp(message.moveX, -1, 1),
    moveY: clamp(message.moveY, -1, 1),
    aimX: clamp(message.aimX, 0, WORLD_WIDTH),
    aimY: clamp(message.aimY, 0, WORLD_HEIGHT),
    fire: message.fire,
  };
}

function parseAction(message: Record<string, unknown>): ActionMessage | undefined {
  if (
    message.action === "dock" ||
    message.action === "repair" ||
    message.action === "repairMothership"
  ) {
    return { type: "action", action: message.action };
  }
  if (message.action === "upgradeClass" && isShipClass(message.value)) {
    return { type: "action", action: "upgradeClass", value: message.value };
  }
  if (message.action === "upgradeStat" && isStatName(message.value)) {
    return { type: "action", action: "upgradeStat", value: message.value };
  }
  return undefined;
}

function handleAction(player: PlayerState, message: ActionMessage, now: number): void {
  if (!player.alive) {
    return;
  }
  if (message.action === "dock") {
    toggleDock(player);
    return;
  }
  if (!player.docked) {
    sendEvent(player.id, "Dock at your mothership first", "bad");
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

function toggleDock(player: PlayerState): void {
  if (player.docked) {
    player.docked = false;
    player.x += player.team === "cyan" ? 70 : -70;
    sendEvent(player.id, "Launch!", "info");
    return;
  }

  const base = motherships[player.team];
  const dockX = dockingX(base);
  let bestPort = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < PORT_Y.length; index += 1) {
    const y = base.y + PORT_Y[index];
    const distance = Math.hypot(player.x - dockX, player.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPort = index;
    }
  }
  if (bestDistance > 105) {
    sendEvent(player.id, "Move into a glowing docking notch", "bad");
    return;
  }

  player.docked = true;
  player.dockedPort = bestPort;
  player.vx = 0;
  player.vy = 0;
  player.x = dockX;
  player.y = base.y + PORT_Y[bestPort];
  player.angle = player.team === "cyan" ? Math.PI : 0;
  depositCargo(player);
}

function depositCargo(player: PlayerState): void {
  if (player.cargo <= 0) {
    sendEvent(player.id, "Docked", "info");
    return;
  }
  const contribution = Math.max(1, Math.floor(player.cargo * 0.25));
  const personal = player.cargo - contribution;
  player.bank += personal;
  teamBank[player.team] += contribution;
  sendEvent(player.id, `Banked ${personal} · team +${contribution}`, "good");
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
  if (shipClass === "scout" || shipClass === player.shipClass) {
    return;
  }
  if (player.bank < CLASS_COST) {
    sendEvent(player.id, `Transformation needs ${CLASS_COST} salvage`, "bad");
    return;
  }
  const oldMax = player.maxHp;
  const oldRatio = player.hp / Math.max(1, oldMax);
  player.bank -= CLASS_COST;
  player.shipClass = shipClass;
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

  updatePlayers(dt, now);
  updateProjectiles(dt, now);
  updateSalvage(dt);
  updateTurrets(now);
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
    if (player.docked) {
      const base = motherships[player.team];
      player.x = dockingX(base);
      player.y = base.y + PORT_Y[player.dockedPort];
      player.vx = 0;
      player.vy = 0;
      player.angle = player.team === "cyan" ? Math.PI : 0;
      continue;
    }

    const config = CLASS_CONFIG[player.shipClass];
    const engineMultiplier = 1 + player.stats.engine * 0.12;
    let moveX = player.input.moveX;
    let moveY = player.input.moveY;
    const magnitude = Math.hypot(moveX, moveY);
    if (magnitude > 1) {
      moveX /= magnitude;
      moveY /= magnitude;
    }
    player.vx += moveX * config.acceleration * engineMultiplier * dt;
    player.vy += moveY * config.acceleration * engineMultiplier * dt;
    const drag = Math.exp(-config.drag * dt);
    player.vx *= drag;
    player.vy *= drag;
    const maxSpeed = config.speed * engineMultiplier * (player.dashing ? 1.9 : 1);
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
    player.x = clamp(player.x + player.vx * dt, 22, WORLD_WIDTH - 22);
    player.y = clamp(player.y + player.vy * dt, 22, WORLD_HEIGHT - 22);

    for (const asteroid of asteroids) {
      resolveCircleCollision(player, asteroid.x, asteroid.y, asteroid.radius + config.radius);
    }
    for (const base of Object.values(motherships)) {
      resolveBaseCollision(player, base, config.radius);
    }

    if (!winner && player.input.fire && now >= player.nextFireAt) {
      fireWeapon(player, now);
    }
    if (player.dashing) {
      applyDashDamage(player, now);
    }

    const pickupRadius = 27 + player.stats.mining * 13;
    for (let index = salvage.length - 1; index >= 0; index -= 1) {
      const item = salvage[index];
      if (Math.hypot(player.x - item.x, player.y - item.y) <= pickupRadius) {
        player.cargo += item.value;
        salvage.splice(index, 1);
      }
    }
  }
}

function fireWeapon(player: PlayerState, now: number): void {
  const config = CLASS_CONFIG[player.shipClass];
  const cooldownMultiplier = 1 + player.stats.weapon * 0.14;
  player.nextFireAt = now + (config.cooldown * 1000) / cooldownMultiplier;
  const damageMultiplier = 1 + player.stats.weapon * 0.18;
  const miningMultiplier = 1 + player.stats.mining * 0.35;

  if (player.shipClass === "chevron") {
    player.dashUntil = now + 320;
    player.dashHits.clear();
    player.vx += Math.cos(player.angle) * 580;
    player.vy += Math.sin(player.angle) * 580;
    return;
  }

  if (player.shipClass === "star") {
    for (let index = 0; index < 8; index += 1) {
      spawnProjectile(
        player,
        (Math.PI * 2 * index) / 8,
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

  if (player.shipClass === "hive") {
    for (const offset of [-0.28, -0.09, 0.09, 0.28]) {
      spawnProjectile(
        player,
        player.angle + offset,
        "drone",
        config.bulletSpeed,
        config.damage * damageMultiplier,
        config.damage * 1.6 * miningMultiplier,
        now,
        1,
      );
    }
    return;
  }

  const kind: ProjectileKind = player.shipClass === "needle" ? "needle" : "bolt";
  spawnProjectile(
    player,
    player.angle,
    kind,
    config.bulletSpeed,
    config.damage * damageMultiplier,
    config.damage * miningMultiplier,
    now,
    player.shipClass === "needle" ? 3 : 1,
  );
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
  });
  if (projectiles.length > MAX_PROJECTILES) {
    projectiles.splice(0, projectiles.length - MAX_PROJECTILES);
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
    if (
      projectile.x < -30 ||
      projectile.y < -30 ||
      projectile.x > WORLD_WIDTH + 30 ||
      projectile.y > WORLD_HEIGHT + 30
    ) {
      projectiles.splice(index, 1);
      continue;
    }

    let hit = false;
    for (const asteroid of asteroids) {
      if (
        Math.hypot(projectile.x - asteroid.x, projectile.y - asteroid.y) <=
        asteroid.radius + projectile.radius
      ) {
        asteroid.hp -= projectile.asteroidDamage;
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
          const destroyed = damagePlayer(player, projectile.damage, now);
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
      enemyBase.hp = Math.max(0, enemyBase.hp - projectile.damage);
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
      if (enemyBase.hp <= 0) {
        declareWinner(projectile.team, now);
      }
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
  const damage = CLASS_CONFIG.chevron.damage * (1 + player.stats.weapon * 0.18);
  for (const target of players.values()) {
    if (
      !target.alive ||
      target.docked ||
      target.team === player.team ||
      player.dashHits.has(target.id)
    ) {
      continue;
    }
    const radius = CLASS_CONFIG[target.shipClass].radius + CLASS_CONFIG.chevron.radius;
    if (Math.hypot(player.x - target.x, player.y - target.y) <= radius) {
      player.dashHits.add(target.id);
      const destroyed = damagePlayer(target, damage, now);
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
    enemyBase.hp = Math.max(0, enemyBase.hp - damage * 1.2);
    broadcastEffect({
      type: "effect",
      kind: "dashHit",
      x: player.x,
      y: player.y,
      team: enemyBase.team,
      intensity: 1.8,
    });
    player.dashUntil = now;
    if (enemyBase.hp <= 0) {
      declareWinner(player.team, now);
    }
  }
}

function damagePlayer(player: PlayerState, damage: number, now: number): boolean {
  player.hp -= damage;
  if (player.hp <= 0) {
    destroyPlayer(player, now);
    return true;
  }
  return false;
}

function destroyPlayer(player: PlayerState, now: number): void {
  player.alive = false;
  player.docked = false;
  player.hp = 0;
  player.respawnAt = now + 3200;
  player.vx = 0;
  player.vy = 0;
  const drops = Math.min(8, Math.max(2, Math.ceil(player.cargo / 5)));
  let remaining = player.cargo;
  for (let index = 0; index < drops && remaining > 0; index += 1) {
    const value = Math.max(1, Math.ceil(remaining / (drops - index)));
    remaining -= value;
    const angle = Math.random() * Math.PI * 2;
    salvage.push({
      id: nextEntityId++,
      x: player.x,
      y: player.y,
      vx: Math.cos(angle) * (35 + Math.random() * 45),
      vy: Math.sin(angle) * (35 + Math.random() * 45),
      value,
    });
  }
  player.cargo = 0;
  sendEvent(player.id, "Ship lost · transformation retained", "bad");
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
}

function updateTurrets(now: number): void {
  if (winner) {
    return;
  }
  for (const base of Object.values(motherships)) {
    if (now < base.nextTurretAt) {
      continue;
    }
    let target: PlayerState | undefined;
    let bestDistance = 650;
    for (const player of players.values()) {
      if (!player.alive || player.docked || player.team === base.team) {
        continue;
      }
      const distance = Math.hypot(base.x - player.x, base.y - player.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        target = player;
      }
    }
    if (!target) {
      continue;
    }
    const turretIndex = Math.floor((now / 900) % PORT_Y.length);
    const x = base.x + (base.team === "cyan" ? base.width / 2 + 8 : -base.width / 2 - 8);
    const y = base.y + PORT_Y[turretIndex];
    const angle = Math.atan2(target.y - y, target.x - x);
    projectiles.push({
      id: nextEntityId++,
      ownerId: `base-${base.team}`,
      team: base.team,
      x,
      y,
      vx: Math.cos(angle) * 520,
      vy: Math.sin(angle) * 520,
      radius: 4,
      kind: "turret",
      damage: 16,
      asteroidDamage: 8,
      expiresAt: now + 1200,
      pierce: 1,
    });
    base.nextTurretAt = now + 800;
  }
}

function declareWinner(team: Team, now: number): void {
  if (winner) {
    return;
  }
  winner = team;
  resetAt = now + 8000;
  broadcastEvent(`${team.toUpperCase()} mothership victory`, "good");
}

function resetRound(now: number): void {
  winner = null;
  resetAt = 0;
  projectiles = [];
  salvage = [];
  asteroids = Array.from({ length: ASTEROID_COUNT }, (_, index) => makeAsteroid(index + 1));
  teamBank.cyan = 0;
  teamBank.magenta = 0;
  for (const base of Object.values(motherships)) {
    base.hp = base.maxHp;
    base.nextTurretAt = now + 1500;
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
    player.alive = true;
    player.docked = false;
    player.respawnAt = 0;
    player.dashUntil = 0;
    player.angle = player.team === "cyan" ? 0 : Math.PI;
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
    radius: 0,
    hp: 0,
    maxHp: 0,
    seed: 0,
  };
  resetAsteroid(asteroid);
  return asteroid;
}

function resetAsteroid(asteroid: AsteroidState): void {
  asteroid.x = 510 + Math.random() * (WORLD_WIDTH - 1020);
  asteroid.y = 100 + Math.random() * (WORLD_HEIGHT - 200);
  asteroid.radius = 27 + Math.random() * 35;
  asteroid.maxHp = asteroid.radius * 2.4;
  asteroid.hp = asteroid.maxHp;
  asteroid.seed = Math.floor(Math.random() * 100000);
}

function sendSnapshots(now: number): void {
  const allShips = Array.from(
    players.values(),
    (player): ShipView => ({
      id: player.id,
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
      radius: rounded(asteroid.radius),
      hp: rounded(asteroid.hp),
      maxHp: rounded(asteroid.maxHp),
      seed: asteroid.seed,
    }),
  );
  const allSalvage = salvage.map(
    (item): SalvageView => ({
      id: item.id,
      x: rounded(item.x),
      y: rounded(item.y),
      value: item.value,
    }),
  );
  const allProjectiles = projectiles.map(
    (projectile): ProjectileView => ({
      id: projectile.id,
      ownerId: projectile.ownerId,
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
    const nearby = (x: number, y: number, radius = INTEREST_RADIUS): boolean =>
      Math.hypot(x - focus.x, y - focus.y) <= radius;
    const snapshot: SnapshotMessage = {
      ...snapshotBase,
      selfId: connection.id,
      ships: allShips.filter((ship) => ship.id === connection.id || nearby(ship.x, ship.y)),
      asteroids: allAsteroids.filter((asteroid) => nearby(asteroid.x, asteroid.y)),
      salvage: allSalvage.filter((item) => nearby(item.x, item.y)),
      projectiles: allProjectiles.filter((projectile) =>
        nearby(projectile.x, projectile.y, INTEREST_RADIUS + 300),
      ),
    };
    server.streams.send(connection.id, snapshot as unknown as NetworkMessage);
  }
}

function sendEvent(connectionId: string, text: string, tone: EventMessage["tone"]): void {
  const message: EventMessage = { type: "event", text, tone };
  server.datagrams.send(connectionId, message as unknown as NetworkMessage);
}

function broadcastEvent(text: string, tone: EventMessage["tone"]): void {
  const message: EventMessage = { type: "event", text, tone };
  server.datagrams.broadcast(message as unknown as NetworkMessage);
}

function broadcastEffect(message: EffectMessage): void {
  server.datagrams.broadcast(message as unknown as NetworkMessage);
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

function dockingX(base: MothershipState): number {
  return base.x + (base.team === "cyan" ? base.width / 2 + 32 : -base.width / 2 - 32);
}

function spawnPoint(team: Team): { x: number; y: number } {
  return {
    x: team === "cyan" ? 380 : WORLD_WIDTH - 380,
    y: WORLD_HEIGHT / 2 + (Math.random() - 0.5) * 320,
  };
}

function playerMaxHp(player: PlayerState): number {
  return CLASS_CONFIG[player.shipClass].maxHp * (1 + player.stats.hull * 0.2);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isShipClass(value: unknown): value is ShipClass {
  return (
    value === "scout" ||
    value === "needle" ||
    value === "hive" ||
    value === "star" ||
    value === "chevron"
  );
}

function isStatName(value: unknown): value is StatName {
  return value === "weapon" || value === "engine" || value === "hull" || value === "mining";
}
