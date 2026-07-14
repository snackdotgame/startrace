import {
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type ActionMessage,
  type AsteroidView,
  type EffectMessage,
  type EventMessage,
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
} from "./messages.js";

export const PROTOCOL_VERSION = 1;
export const DATAGRAM_BUDGET_BYTES = 1000;
export const MAX_SNAPSHOT_SHIPS = 12;
export const MAX_SNAPSHOT_ASTEROIDS = 18;
export const MAX_SNAPSHOT_SALVAGE = 8;
export const MAX_SNAPSHOT_PROJECTILES = 18;

export enum PacketKind {
  Input = 1,
  Snapshot = 2,
  Action = 3,
  Event = 4,
  Effect = 5,
  Identity = 6,
}

export interface PlayerIdentity {
  id: number;
  name: string;
}

export interface IdentityBatch {
  replace: boolean;
  identities: PlayerIdentity[];
}

const INPUT_BYTES = 15;
const ACTION_BYTES = 4;
const EFFECT_BYTES = 13;
const SNAPSHOT_HEADER_BYTES = 27;
const SHIP_BYTES = 24;
const ASTEROID_BYTES = 17;
const SALVAGE_BYTES = 9;
const PROJECTILE_BYTES = 16;
const MAX_IDENTITIES = 16;
const MAX_NAME_BYTES = 24;
const MAX_EVENT_BYTES = 160;
const MOVE_SCALE = 32767;
const VELOCITY_SCALE = 8;
const HEALTH_SCALE = 4;
const INTENSITY_SCALE = 32;
const MOTHERSHIP_MAX_HP = 1800;
const MOTHERSHIP_WIDTH = 180;
const MOTHERSHIP_HEIGHT = 720;
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const SHIP_CLASSES: readonly ShipClass[] = ["scout", "needle", "hive", "star", "chevron"];
const STAT_NAMES: readonly StatName[] = ["weapon", "engine", "hull", "mining"];
const PROJECTILE_KINDS: readonly ProjectileKind[] = ["bolt", "needle", "drone", "turret"];
const EFFECT_KINDS: readonly EffectMessage["kind"][] = [
  "asteroidHit",
  "asteroidBreak",
  "shipHit",
  "shipBreak",
  "baseHit",
  "dashHit",
];

class Writer {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  offset = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  u8(value: number): void {
    this.view.setUint8(this.offset, value);
    this.offset += 1;
  }

  i16(value: number): void {
    this.view.setInt16(this.offset, value, true);
    this.offset += 2;
  }

  u16(value: number): void {
    this.view.setUint16(this.offset, value, true);
    this.offset += 2;
  }

  u32(value: number): void {
    this.view.setUint32(this.offset, value, true);
    this.offset += 4;
  }

  raw(value: Uint8Array): void {
    this.bytes.set(value, this.offset);
    this.offset += value.byteLength;
  }

  finish(): Uint8Array {
    if (this.offset !== this.bytes.byteLength) throw new Error("Protocol writer size mismatch");
    return this.bytes;
  }
}

class Reader {
  readonly view: DataView;
  offset = 0;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  remaining(count: number): boolean {
    return this.offset + count <= this.bytes.byteLength;
  }

  u8(): number | undefined {
    if (!this.remaining(1)) return undefined;
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  i16(): number | undefined {
    if (!this.remaining(2)) return undefined;
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u16(): number | undefined {
    if (!this.remaining(2)) return undefined;
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u32(): number | undefined {
    if (!this.remaining(4)) return undefined;
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  raw(count: number): Uint8Array | undefined {
    if (!this.remaining(count)) return undefined;
    const value = this.bytes.subarray(this.offset, this.offset + count);
    this.offset += count;
    return value;
  }

  done(): boolean {
    return this.offset === this.bytes.byteLength;
  }
}

export function packetKind(bytes: Uint8Array): PacketKind | undefined {
  if (bytes.byteLength < 2 || bytes[0] !== PROTOCOL_VERSION) return undefined;
  const kind = bytes[1];
  return kind >= PacketKind.Input && kind <= PacketKind.Identity ? (kind as PacketKind) : undefined;
}

export function encodeInput(message: InputMessage): Uint8Array {
  if (
    !isUint32(message.sequence) ||
    !finiteIn(message.moveX, -1, 1) ||
    !finiteIn(message.moveY, -1, 1) ||
    !finiteIn(message.aimX, 0, WORLD_WIDTH) ||
    !finiteIn(message.aimY, 0, WORLD_HEIGHT)
  ) {
    throw new Error("Invalid local input packet");
  }
  const writer = new Writer(INPUT_BYTES);
  writer.u8(PROTOCOL_VERSION);
  writer.u8(PacketKind.Input);
  writer.u32(message.sequence);
  writer.i16(Math.round(message.moveX * MOVE_SCALE));
  writer.i16(Math.round(message.moveY * MOVE_SCALE));
  writer.u16(quantizeUnit(message.aimX, WORLD_WIDTH));
  writer.u16(quantizeUnit(message.aimY, WORLD_HEIGHT));
  writer.u8(message.fire ? 1 : 0);
  return writer.finish();
}

export function decodeInput(bytes: Uint8Array): InputMessage | undefined {
  if (bytes.byteLength !== INPUT_BYTES || packetKind(bytes) !== PacketKind.Input) return undefined;
  const reader = new Reader(bytes);
  reader.offset = 2;
  const sequence = reader.u32();
  const rawMoveX = reader.i16();
  const rawMoveY = reader.i16();
  const rawAimX = reader.u16();
  const rawAimY = reader.u16();
  const flags = reader.u8();
  if (
    sequence === undefined ||
    rawMoveX === undefined ||
    rawMoveY === undefined ||
    rawAimX === undefined ||
    rawAimY === undefined ||
    flags === undefined ||
    rawMoveX < -MOVE_SCALE ||
    rawMoveY < -MOVE_SCALE ||
    (flags & ~1) !== 0 ||
    !reader.done()
  ) {
    return undefined;
  }
  return {
    type: "input",
    sequence,
    moveX: rawMoveX / MOVE_SCALE,
    moveY: rawMoveY / MOVE_SCALE,
    aimX: dequantizeUnit(rawAimX, WORLD_WIDTH),
    aimY: dequantizeUnit(rawAimY, WORLD_HEIGHT),
    fire: flags === 1,
  };
}

export function encodeAction(message: ActionMessage): Uint8Array {
  const writer = new Writer(ACTION_BYTES);
  writer.u8(PROTOCOL_VERSION);
  writer.u8(PacketKind.Action);
  if (message.action === "dock") {
    writer.u8(0);
    writer.u8(0);
  } else if (message.action === "repair") {
    writer.u8(1);
    writer.u8(0);
  } else if (message.action === "repairMothership") {
    writer.u8(2);
    writer.u8(0);
  } else if (message.action === "upgradeClass") {
    const value = SHIP_CLASSES.indexOf(message.value);
    if (value < 0) throw new Error("Invalid class action");
    writer.u8(3);
    writer.u8(value);
  } else {
    const value = STAT_NAMES.indexOf(message.value);
    if (value < 0) throw new Error("Invalid stat action");
    writer.u8(4);
    writer.u8(value);
  }
  return writer.finish();
}

export function decodeAction(bytes: Uint8Array): ActionMessage | undefined {
  if (bytes.byteLength !== ACTION_BYTES || packetKind(bytes) !== PacketKind.Action)
    return undefined;
  const action = bytes[2];
  const value = bytes[3];
  if (action === 0 && value === 0) return { type: "action", action: "dock" };
  if (action === 1 && value === 0) return { type: "action", action: "repair" };
  if (action === 2 && value === 0) return { type: "action", action: "repairMothership" };
  if (action === 3 && value < SHIP_CLASSES.length) {
    return { type: "action", action: "upgradeClass", value: SHIP_CLASSES[value] };
  }
  if (action === 4 && value < STAT_NAMES.length) {
    return { type: "action", action: "upgradeStat", value: STAT_NAMES[value] };
  }
  return undefined;
}

export function encodeEvent(message: EventMessage): Uint8Array {
  const text = UTF8_ENCODER.encode(message.text);
  if (text.byteLength > MAX_EVENT_BYTES) throw new Error("Event text exceeds protocol cap");
  const writer = new Writer(4 + text.byteLength);
  writer.u8(PROTOCOL_VERSION);
  writer.u8(PacketKind.Event);
  writer.u8(toneCode(message.tone));
  writer.u8(text.byteLength);
  writer.raw(text);
  return writer.finish();
}

export function decodeEvent(bytes: Uint8Array): EventMessage | undefined {
  if (bytes.byteLength < 4 || packetKind(bytes) !== PacketKind.Event) return undefined;
  const reader = new Reader(bytes);
  reader.offset = 2;
  const tone = reader.u8();
  const length = reader.u8();
  if (tone === undefined || tone > 2 || length === undefined || length > MAX_EVENT_BYTES) {
    return undefined;
  }
  const raw = reader.raw(length);
  if (!raw || !reader.done()) return undefined;
  try {
    return {
      type: "event",
      tone: ["info", "good", "bad"][tone] as EventMessage["tone"],
      text: UTF8_DECODER.decode(raw),
    };
  } catch {
    return undefined;
  }
}

export function encodeEffect(message: EffectMessage): Uint8Array {
  const kind = EFFECT_KINDS.indexOf(message.kind);
  if (
    kind < 0 ||
    !isUint32(message.id) ||
    !finiteIn(message.x, 0, WORLD_WIDTH) ||
    !finiteIn(message.y, 0, WORLD_HEIGHT) ||
    !finiteIn(message.intensity, 0, 255 / INTENSITY_SCALE)
  ) {
    throw new Error("Invalid local effect packet");
  }
  const writer = new Writer(EFFECT_BYTES);
  writer.u8(PROTOCOL_VERSION);
  writer.u8(PacketKind.Effect);
  writer.u32(message.id);
  writer.u8(kind);
  writer.u8(message.team === undefined ? 0 : message.team === "cyan" ? 1 : 2);
  writer.u16(quantizeUnit(message.x, WORLD_WIDTH));
  writer.u16(quantizeUnit(message.y, WORLD_HEIGHT));
  writer.u8(Math.round(message.intensity * INTENSITY_SCALE));
  return writer.finish();
}

export function decodeEffect(bytes: Uint8Array): EffectMessage | undefined {
  if (bytes.byteLength !== EFFECT_BYTES || packetKind(bytes) !== PacketKind.Effect)
    return undefined;
  const reader = new Reader(bytes);
  reader.offset = 2;
  const id = reader.u32();
  const kind = reader.u8();
  const team = reader.u8();
  const x = reader.u16();
  const y = reader.u16();
  const intensity = reader.u8();
  if (
    id === undefined ||
    kind === undefined ||
    kind >= EFFECT_KINDS.length ||
    team === undefined ||
    team > 2 ||
    x === undefined ||
    y === undefined ||
    intensity === undefined ||
    !reader.done()
  ) {
    return undefined;
  }
  return {
    type: "effect",
    id,
    kind: EFFECT_KINDS[kind],
    x: dequantizeUnit(x, WORLD_WIDTH),
    y: dequantizeUnit(y, WORLD_HEIGHT),
    team: team === 0 ? undefined : team === 1 ? "cyan" : "magenta",
    intensity: intensity / INTENSITY_SCALE,
  };
}

export function encodeIdentities(
  identities: readonly PlayerIdentity[],
  replace = false,
): Uint8Array {
  if (identities.length > MAX_IDENTITIES) throw new Error("Too many identities");
  const encoded = identities.map((identity) => {
    const name = UTF8_ENCODER.encode(identity.name);
    if (!isUint16(identity.id) || identity.id === 0 || name.byteLength > MAX_NAME_BYTES) {
      throw new Error("Invalid local identity");
    }
    return { identity, name };
  });
  const size = 4 + encoded.reduce((total, item) => total + 3 + item.name.byteLength, 0);
  const writer = new Writer(size);
  writer.u8(PROTOCOL_VERSION);
  writer.u8(PacketKind.Identity);
  writer.u8(replace ? 1 : 0);
  writer.u8(encoded.length);
  for (const { identity, name } of encoded) {
    writer.u16(identity.id);
    writer.u8(name.byteLength);
    writer.raw(name);
  }
  return writer.finish();
}

export function decodeIdentities(bytes: Uint8Array): IdentityBatch | undefined {
  if (bytes.byteLength < 4 || packetKind(bytes) !== PacketKind.Identity) return undefined;
  const reader = new Reader(bytes);
  reader.offset = 2;
  const flags = reader.u8();
  const count = reader.u8();
  if (flags === undefined || (flags & ~1) !== 0 || count === undefined || count > MAX_IDENTITIES) {
    return undefined;
  }
  const identities: PlayerIdentity[] = [];
  const ids = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    const id = reader.u16();
    const length = reader.u8();
    if (
      id === undefined ||
      id === 0 ||
      ids.has(id) ||
      length === undefined ||
      length > MAX_NAME_BYTES
    ) {
      return undefined;
    }
    const raw = reader.raw(length);
    if (!raw) return undefined;
    try {
      identities.push({ id, name: UTF8_DECODER.decode(raw) });
    } catch {
      return undefined;
    }
    ids.add(id);
  }
  return reader.done() ? { replace: flags === 1, identities } : undefined;
}

export function snapshotByteLength(snapshot: SnapshotMessage): number {
  return (
    SNAPSHOT_HEADER_BYTES +
    snapshot.ships.length * SHIP_BYTES +
    snapshot.asteroids.length * ASTEROID_BYTES +
    snapshot.salvage.length * SALVAGE_BYTES +
    snapshot.projectiles.length * PROJECTILE_BYTES
  );
}

export function encodeSnapshot(snapshot: SnapshotMessage): Uint8Array {
  validateSnapshotCounts(snapshot);
  const size = snapshotByteLength(snapshot);
  if (size > DATAGRAM_BUDGET_BYTES)
    throw new Error(`Snapshot exceeds ${DATAGRAM_BUDGET_BYTES} bytes`);
  const writer = new Writer(size);
  writer.u8(PROTOCOL_VERSION);
  writer.u8(PacketKind.Snapshot);
  writer.u32(assertUint32(snapshot.sequence, "snapshot sequence"));
  writer.u32(assertUint32(Math.round(snapshot.serverTime), "server time"));
  writer.u16(parseWireId(snapshot.selfId));
  writer.u8(snapshot.winner === null ? 0 : snapshot.winner === "cyan" ? 1 : 2);
  writer.u16(quantizeDuration(snapshot.resetIn));
  writer.u16(clampUint16(snapshot.teamBank.cyan));
  writer.u16(clampUint16(snapshot.teamBank.magenta));
  writer.u16(quantizeHealth(snapshot.motherships.find((base) => base.team === "cyan")?.hp ?? 0));
  writer.u16(quantizeHealth(snapshot.motherships.find((base) => base.team === "magenta")?.hp ?? 0));
  writer.u8(snapshot.ships.length);
  writer.u8(snapshot.asteroids.length);
  writer.u8(snapshot.salvage.length);
  writer.u8(snapshot.projectiles.length);
  for (const ship of snapshot.ships) writeShip(writer, ship);
  for (const asteroid of snapshot.asteroids) writeAsteroid(writer, asteroid);
  for (const item of snapshot.salvage) writeSalvage(writer, item);
  for (const projectile of snapshot.projectiles) writeProjectile(writer, projectile);
  return writer.finish();
}

export function decodeSnapshot(
  bytes: Uint8Array,
  namesById: ReadonlyMap<number, string>,
): SnapshotMessage | undefined {
  if (
    bytes.byteLength < SNAPSHOT_HEADER_BYTES ||
    bytes.byteLength > DATAGRAM_BUDGET_BYTES ||
    packetKind(bytes) !== PacketKind.Snapshot
  ) {
    return undefined;
  }
  const reader = new Reader(bytes);
  reader.offset = 2;
  const sequence = reader.u32();
  const serverTime = reader.u32();
  const selfId = reader.u16();
  const winner = reader.u8();
  const resetIn = reader.u16();
  const cyanBank = reader.u16();
  const magentaBank = reader.u16();
  const cyanHp = reader.u16();
  const magentaHp = reader.u16();
  const shipCount = reader.u8();
  const asteroidCount = reader.u8();
  const salvageCount = reader.u8();
  const projectileCount = reader.u8();
  if (
    sequence === undefined ||
    serverTime === undefined ||
    selfId === undefined ||
    selfId === 0 ||
    winner === undefined ||
    winner > 2 ||
    resetIn === undefined ||
    cyanBank === undefined ||
    magentaBank === undefined ||
    cyanHp === undefined ||
    magentaHp === undefined ||
    shipCount === undefined ||
    shipCount > MAX_SNAPSHOT_SHIPS ||
    asteroidCount === undefined ||
    asteroidCount > MAX_SNAPSHOT_ASTEROIDS ||
    salvageCount === undefined ||
    salvageCount > MAX_SNAPSHOT_SALVAGE ||
    projectileCount === undefined ||
    projectileCount > MAX_SNAPSHOT_PROJECTILES
  ) {
    return undefined;
  }
  const expected =
    SNAPSHOT_HEADER_BYTES +
    shipCount * SHIP_BYTES +
    asteroidCount * ASTEROID_BYTES +
    salvageCount * SALVAGE_BYTES +
    projectileCount * PROJECTILE_BYTES;
  if (expected !== bytes.byteLength) return undefined;
  const ships: ShipView[] = [];
  const asteroids: AsteroidView[] = [];
  const salvage: SalvageView[] = [];
  const projectiles: ProjectileView[] = [];
  for (let index = 0; index < shipCount; index += 1) {
    const ship = readShip(reader, namesById);
    if (!ship) return undefined;
    ships.push(ship);
  }
  for (let index = 0; index < asteroidCount; index += 1) {
    const asteroid = readAsteroid(reader);
    if (!asteroid) return undefined;
    asteroids.push(asteroid);
  }
  for (let index = 0; index < salvageCount; index += 1) {
    const item = readSalvage(reader);
    if (!item) return undefined;
    salvage.push(item);
  }
  for (let index = 0; index < projectileCount; index += 1) {
    const projectile = readProjectile(reader);
    if (!projectile) return undefined;
    projectiles.push(projectile);
  }
  if (!reader.done()) return undefined;
  return {
    type: "snapshot",
    sequence,
    selfId: String(selfId),
    serverTime,
    ships,
    motherships: [makeMothership("cyan", cyanHp), makeMothership("magenta", magentaHp)],
    asteroids,
    salvage,
    projectiles,
    teamBank: { cyan: cyanBank, magenta: magentaBank },
    winner: winner === 0 ? null : winner === 1 ? "cyan" : "magenta",
    resetIn: resetIn / 100,
  };
}

function writeShip(writer: Writer, ship: ShipView): void {
  const classIndex = SHIP_CLASSES.indexOf(ship.shipClass);
  if (classIndex < 0) throw new Error("Invalid ship class");
  writer.u16(parseWireId(ship.id));
  writer.u8(
    (teamBit(ship.team) |
      (classIndex << 1) |
      (ship.docked ? 16 : 0) |
      (ship.alive ? 32 : 0) |
      (ship.dashing ? 64 : 0)) >>>
      0,
  );
  writer.u16(quantizeUnit(ship.x, WORLD_WIDTH));
  writer.u16(quantizeUnit(ship.y, WORLD_HEIGHT));
  writer.i16(quantizeVelocity(ship.vx));
  writer.i16(quantizeVelocity(ship.vy));
  writer.u16(quantizeAngle(ship.angle));
  writer.u16(quantizeHealth(ship.hp));
  writer.u16(quantizeHealth(ship.maxHp));
  writer.u16(clampUint16(ship.cargo));
  writer.u16(clampUint16(ship.bank));
  writer.u8(packStats(ship.stats));
  writer.u16(quantizeDuration(ship.respawnIn));
}

function readShip(reader: Reader, namesById: ReadonlyMap<number, string>): ShipView | undefined {
  const id = reader.u16();
  const flags = reader.u8();
  const x = reader.u16();
  const y = reader.u16();
  const vx = reader.i16();
  const vy = reader.i16();
  const angle = reader.u16();
  const hp = reader.u16();
  const maxHp = reader.u16();
  const cargo = reader.u16();
  const bank = reader.u16();
  const stats = reader.u8();
  const respawn = reader.u16();
  if (
    [id, flags, x, y, vx, vy, angle, hp, maxHp, cargo, bank, stats, respawn].some(
      (value) => value === undefined,
    )
  )
    return undefined;
  const safeId = id as number;
  const safeFlags = flags as number;
  const classIndex = (safeFlags >>> 1) & 7;
  if (safeId === 0 || classIndex >= SHIP_CLASSES.length || (safeFlags & 128) !== 0)
    return undefined;
  const unpacked = unpackStats(stats as number);
  if (!unpacked) return undefined;
  return {
    id: String(safeId),
    name: namesById.get(safeId) ?? `PILOT ${safeId}`,
    team: (safeFlags & 1) === 0 ? "cyan" : "magenta",
    shipClass: SHIP_CLASSES[classIndex],
    docked: (safeFlags & 16) !== 0,
    alive: (safeFlags & 32) !== 0,
    dashing: (safeFlags & 64) !== 0,
    x: dequantizeUnit(x as number, WORLD_WIDTH),
    y: dequantizeUnit(y as number, WORLD_HEIGHT),
    vx: (vx as number) / VELOCITY_SCALE,
    vy: (vy as number) / VELOCITY_SCALE,
    angle: dequantizeAngle(angle as number),
    hp: (hp as number) / HEALTH_SCALE,
    maxHp: (maxHp as number) / HEALTH_SCALE,
    cargo: cargo as number,
    bank: bank as number,
    stats: unpacked,
    respawnIn: (respawn as number) / 100,
  };
}

function writeAsteroid(writer: Writer, asteroid: AsteroidView): void {
  writer.u32(assertUint32(asteroid.id, "asteroid id"));
  writer.u16(quantizeUnit(asteroid.x, WORLD_WIDTH));
  writer.u16(quantizeUnit(asteroid.y, WORLD_HEIGHT));
  writer.u8(clampUint8(asteroid.radius));
  writer.u16(quantizeHealth(asteroid.hp));
  writer.u16(quantizeHealth(asteroid.maxHp));
  writer.u32(assertUint32(asteroid.seed, "asteroid seed"));
}

function readAsteroid(reader: Reader): AsteroidView | undefined {
  const id = reader.u32();
  const x = reader.u16();
  const y = reader.u16();
  const radius = reader.u8();
  const hp = reader.u16();
  const maxHp = reader.u16();
  const seed = reader.u32();
  if ([id, x, y, radius, hp, maxHp, seed].some((value) => value === undefined)) return undefined;
  return {
    id: id as number,
    x: dequantizeUnit(x as number, WORLD_WIDTH),
    y: dequantizeUnit(y as number, WORLD_HEIGHT),
    radius: radius as number,
    hp: (hp as number) / HEALTH_SCALE,
    maxHp: (maxHp as number) / HEALTH_SCALE,
    seed: seed as number,
  };
}

function writeSalvage(writer: Writer, item: SalvageView): void {
  writer.u32(assertUint32(item.id, "salvage id"));
  writer.u16(quantizeUnit(item.x, WORLD_WIDTH));
  writer.u16(quantizeUnit(item.y, WORLD_HEIGHT));
  writer.u8(clampUint8(item.value));
}

function readSalvage(reader: Reader): SalvageView | undefined {
  const id = reader.u32();
  const x = reader.u16();
  const y = reader.u16();
  const value = reader.u8();
  if ([id, x, y, value].some((entry) => entry === undefined)) return undefined;
  return {
    id: id as number,
    x: dequantizeUnit(x as number, WORLD_WIDTH),
    y: dequantizeUnit(y as number, WORLD_HEIGHT),
    value: value as number,
  };
}

function writeProjectile(writer: Writer, projectile: ProjectileView): void {
  const kind = PROJECTILE_KINDS.indexOf(projectile.kind);
  if (kind < 0) throw new Error("Invalid projectile kind");
  writer.u32(assertUint32(projectile.id, "projectile id"));
  writer.u16(projectile.ownerId === "turret" ? 0 : parseWireId(projectile.ownerId));
  writer.u8(teamBit(projectile.team) | (kind << 1));
  writer.u16(quantizeUnit(projectile.x, WORLD_WIDTH));
  writer.u16(quantizeUnit(projectile.y, WORLD_HEIGHT));
  writer.i16(quantizeVelocity(projectile.vx));
  writer.i16(quantizeVelocity(projectile.vy));
  writer.u8(clampUint8(projectile.radius));
}

function readProjectile(reader: Reader): ProjectileView | undefined {
  const id = reader.u32();
  const ownerId = reader.u16();
  const flags = reader.u8();
  const x = reader.u16();
  const y = reader.u16();
  const vx = reader.i16();
  const vy = reader.i16();
  const radius = reader.u8();
  if ([id, ownerId, flags, x, y, vx, vy, radius].some((value) => value === undefined))
    return undefined;
  const safeFlags = flags as number;
  const kind = (safeFlags >>> 1) & 3;
  if ((safeFlags & 0xf8) !== 0 || kind >= PROJECTILE_KINDS.length) return undefined;
  return {
    id: id as number,
    ownerId: ownerId === 0 ? "turret" : String(ownerId),
    team: (safeFlags & 1) === 0 ? "cyan" : "magenta",
    kind: PROJECTILE_KINDS[kind],
    x: dequantizeUnit(x as number, WORLD_WIDTH),
    y: dequantizeUnit(y as number, WORLD_HEIGHT),
    vx: (vx as number) / VELOCITY_SCALE,
    vy: (vy as number) / VELOCITY_SCALE,
    radius: radius as number,
  };
}

function validateSnapshotCounts(snapshot: SnapshotMessage): void {
  if (
    snapshot.ships.length > MAX_SNAPSHOT_SHIPS ||
    snapshot.asteroids.length > MAX_SNAPSHOT_ASTEROIDS ||
    snapshot.salvage.length > MAX_SNAPSHOT_SALVAGE ||
    snapshot.projectiles.length > MAX_SNAPSHOT_PROJECTILES
  ) {
    throw new Error("Snapshot entity count exceeds protocol cap");
  }
}

function makeMothership(team: Team, rawHp: number): MothershipView {
  return {
    team,
    x: team === "cyan" ? 190 : WORLD_WIDTH - 190,
    y: WORLD_HEIGHT / 2,
    width: MOTHERSHIP_WIDTH,
    height: MOTHERSHIP_HEIGHT,
    hp: rawHp / HEALTH_SCALE,
    maxHp: MOTHERSHIP_MAX_HP,
  };
}

function teamBit(team: Team): number {
  return team === "cyan" ? 0 : 1;
}

function toneCode(tone: EventMessage["tone"]): number {
  return tone === "info" ? 0 : tone === "good" ? 1 : 2;
}

function quantizeUnit(value: number, maximum: number): number {
  return Math.round((clamp(value, 0, maximum) / maximum) * 65535);
}

function dequantizeUnit(value: number, maximum: number): number {
  return (value / 65535) * maximum;
}

function quantizeVelocity(value: number): number {
  return Math.round(clamp(value, -4095.875, 4095.875) * VELOCITY_SCALE);
}

function quantizeAngle(value: number): number {
  const turn = (((value / (Math.PI * 2)) % 1) + 1) % 1;
  return Math.round(turn * 65535);
}

function dequantizeAngle(value: number): number {
  return (value / 65535) * Math.PI * 2;
}

function quantizeHealth(value: number): number {
  return clampUint16(Math.round(Math.max(0, value) * HEALTH_SCALE));
}

function quantizeDuration(seconds: number): number {
  return clampUint16(Math.round(Math.max(0, seconds) * 100));
}

function packStats(stats: ShipStats): number {
  for (const name of STAT_NAMES) {
    if (!Number.isInteger(stats[name]) || stats[name] < 0 || stats[name] > 3)
      throw new Error("Invalid ship stats");
  }
  return stats.weapon | (stats.engine << 2) | (stats.hull << 4) | (stats.mining << 6);
}

function unpackStats(value: number): ShipStats | undefined {
  return {
    weapon: value & 3,
    engine: (value >>> 2) & 3,
    hull: (value >>> 4) & 3,
    mining: (value >>> 6) & 3,
  };
}

function parseWireId(value: string): number {
  const id = Number(value);
  if (!isUint16(id) || id === 0) throw new Error(`Invalid wire id ${value}`);
  return id;
}

function finiteIn(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isUint16(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff;
}

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function assertUint32(value: number, label: string): number {
  if (!isUint32(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function clampUint8(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Invalid uint8 source");
  return Math.round(clamp(value, 0, 0xff));
}

function clampUint16(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Invalid uint16 source");
  return Math.round(clamp(value, 0, 0xffff));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function formatPacketForLog(bytes: Uint8Array): string {
  const kind = packetKind(bytes);
  return kind === undefined
    ? `invalid packet (${bytes.byteLength} bytes)`
    : `v${PROTOCOL_VERSION} kind=${PacketKind[kind]} bytes=${bytes.byteLength}`;
}

export function runProtocolSelfTest(): void {
  const input: InputMessage = {
    type: "input",
    sequence: 0x01020304,
    moveX: 0,
    moveY: 0,
    aimX: 0,
    aimY: 0,
    fire: false,
  };
  const golden = [1, 1, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const inputBytes = encodeInput(input);
  if (!golden.every((value, index) => inputBytes[index] === value) || !decodeInput(inputBytes))
    throw new Error("Input protocol golden vector failed");
  if (decodeInput(inputBytes.subarray(0, inputBytes.length - 1)))
    throw new Error("Truncated input accepted");

  const names = new Map<number, string>([[1, "SELF"]]);
  const ships = Array.from(
    { length: MAX_SNAPSHOT_SHIPS },
    (_, index): ShipView => ({
      id: String(index + 1),
      name: `P${index + 1}`,
      team: index % 2 === 0 ? "cyan" : "magenta",
      x: WORLD_WIDTH,
      y: WORLD_HEIGHT,
      vx: 100,
      vy: -100,
      angle: Math.PI,
      hp: 100,
      maxHp: 150,
      cargo: 20,
      bank: 40,
      shipClass: SHIP_CLASSES[index % SHIP_CLASSES.length],
      stats: { weapon: 3, engine: 3, hull: 3, mining: 3 },
      docked: false,
      alive: true,
      respawnIn: 0,
      dashing: false,
    }),
  );
  const asteroids = Array.from(
    { length: MAX_SNAPSHOT_ASTEROIDS },
    (_, index): AsteroidView => ({
      id: index + 1,
      x: WORLD_WIDTH,
      y: WORLD_HEIGHT,
      radius: 60,
      hp: 120,
      maxHp: 120,
      seed: 99999,
    }),
  );
  const salvage = Array.from(
    { length: MAX_SNAPSHOT_SALVAGE },
    (_, index): SalvageView => ({ id: index + 100, x: WORLD_WIDTH, y: WORLD_HEIGHT, value: 5 }),
  );
  const projectiles = Array.from(
    { length: MAX_SNAPSHOT_PROJECTILES },
    (_, index): ProjectileView => ({
      id: index + 200,
      ownerId: "1",
      team: "cyan",
      x: WORLD_WIDTH,
      y: WORLD_HEIGHT,
      vx: 1000,
      vy: -1000,
      radius: 8,
      kind: PROJECTILE_KINDS[index % PROJECTILE_KINDS.length],
    }),
  );
  const snapshot: SnapshotMessage = {
    type: "snapshot",
    sequence: 1,
    selfId: "1",
    serverTime: 1000,
    ships,
    motherships: [
      makeMothership("cyan", MOTHERSHIP_MAX_HP * HEALTH_SCALE),
      makeMothership("magenta", MOTHERSHIP_MAX_HP * HEALTH_SCALE),
    ],
    asteroids,
    salvage,
    projectiles,
    teamBank: { cyan: 10, magenta: 20 },
    winner: null,
    resetIn: 0,
  };
  const snapshotBytes = encodeSnapshot(snapshot);
  if (snapshotBytes.byteLength > DATAGRAM_BUDGET_BYTES || !decodeSnapshot(snapshotBytes, names))
    throw new Error("Worst-case snapshot protocol failed");
  if (decodeSnapshot(new Uint8Array([...snapshotBytes, 0]), names))
    throw new Error("Trailing snapshot garbage accepted");
  const identities = encodeIdentities([{ id: 1, name: "Pilot" }]);
  if (decodeIdentities(identities)?.identities[0]?.name !== "Pilot")
    throw new Error("Identity round trip failed");
  const event = encodeEvent({ type: "event", text: "Ready", tone: "good" });
  if (decodeEvent(event)?.text !== "Ready") throw new Error("Event round trip failed");
  const action = encodeAction({ type: "action", action: "upgradeClass", value: "needle" });
  if (decodeAction(action)?.action !== "upgradeClass") throw new Error("Action round trip failed");
  const effect = encodeEffect({
    type: "effect",
    id: 1,
    kind: "asteroidHit",
    x: 10,
    y: 20,
    intensity: 1,
  });
  if (decodeEffect(effect)?.kind !== "asteroidHit") throw new Error("Effect round trip failed");
}
