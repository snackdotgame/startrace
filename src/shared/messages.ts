export const WORLD_WIDTH = 3200;
export const WORLD_HEIGHT = 2000;

export type Team = "cyan" | "magenta";
export type ShipClass = "scout" | "needle" | "hive" | "star" | "chevron";
export type StatName = "weapon" | "engine" | "hull" | "mining";

export interface ShipPhysics {
  maxHp: number;
  speed: number;
  acceleration: number;
  drag: number;
  radius: number;
  cooldown: number;
  bulletSpeed: number;
  damage: number;
}

export const SHIP_PHYSICS: Record<ShipClass, ShipPhysics> = {
  scout: {
    maxHp: 100,
    speed: 330,
    acceleration: 1400,
    drag: 4.2,
    radius: 15,
    cooldown: 0.18,
    bulletSpeed: 760,
    damage: 13,
  },
  needle: {
    maxHp: 82,
    speed: 285,
    acceleration: 1120,
    drag: 4,
    radius: 20,
    cooldown: 0.62,
    bulletSpeed: 1120,
    damage: 44,
  },
  hive: {
    maxHp: 118,
    speed: 255,
    acceleration: 980,
    drag: 4.3,
    radius: 23,
    cooldown: 0.58,
    bulletSpeed: 410,
    damage: 15,
  },
  star: {
    maxHp: 108,
    speed: 275,
    acceleration: 1050,
    drag: 4.1,
    radius: 24,
    cooldown: 0.42,
    bulletSpeed: 580,
    damage: 10,
  },
  chevron: {
    maxHp: 145,
    speed: 365,
    acceleration: 1550,
    drag: 3.7,
    radius: 28,
    cooldown: 1.25,
    bulletSpeed: 0,
    damage: 55,
  },
};

export interface ShipStats {
  weapon: number;
  engine: number;
  hull: number;
  mining: number;
}

export interface InputMessage {
  type: "input";
  sequence: number;
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fire: boolean;
}

export type ActionMessage =
  | { type: "action"; action: "dock" }
  | { type: "action"; action: "repair" }
  | { type: "action"; action: "repairMothership" }
  | { type: "action"; action: "upgradeClass"; value: ShipClass }
  | { type: "action"; action: "upgradeStat"; value: StatName };

export interface ShipView {
  id: string;
  name: string;
  team: Team;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  maxHp: number;
  cargo: number;
  bank: number;
  shipClass: ShipClass;
  stats: ShipStats;
  docked: boolean;
  alive: boolean;
  respawnIn: number;
  dashing: boolean;
}

export interface MothershipView {
  team: Team;
  x: number;
  y: number;
  width: number;
  height: number;
  hp: number;
  maxHp: number;
}

export interface AsteroidView {
  id: number;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  seed: number;
}

export interface SalvageView {
  id: number;
  x: number;
  y: number;
  value: number;
}

export type ProjectileKind = "bolt" | "needle" | "drone" | "turret";

export interface ProjectileView {
  id: number;
  ownerId: string;
  team: Team;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  kind: ProjectileKind;
}

export interface SnapshotMessage {
  type: "snapshot";
  sequence: number;
  selfId: string;
  serverTime: number;
  ships: ShipView[];
  motherships: MothershipView[];
  asteroids: AsteroidView[];
  salvage: SalvageView[];
  projectiles: ProjectileView[];
  teamBank: Record<Team, number>;
  winner: Team | null;
  resetIn: number;
}

export interface EventMessage {
  type: "event";
  text: string;
  tone: "info" | "good" | "bad";
}

export interface EffectMessage {
  type: "effect";
  id: number;
  kind: "asteroidHit" | "asteroidBreak" | "shipHit" | "shipBreak" | "baseHit" | "dashHit";
  x: number;
  y: number;
  team?: Team;
  intensity: number;
}

export const TEAM_COLORS: Record<Team, string> = {
  cyan: "#63fff3",
  magenta: "#ff5eaa",
};

export const CLASS_COST = 45;
export const MAX_STAT_LEVEL = 3;

export function statCost(level: number): number {
  return 24 + level * 18;
}
