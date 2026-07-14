export const WORLD_WIDTH = 7600;
export const WORLD_HEIGHT = 4400;
export const MOTHERSHIP_X_INSET = 1300;
export const MOTHERSHIP_WIDTH = 420;
export const MOTHERSHIP_HEIGHT = 1400;
export const MOTHERSHIP_MAX_HP = 3000;
export const MOTHERSHIP_PLAYER_TARGET_RANGE = 1500;
export const MOTHERSHIP_LOCK_ON_MS = 200;

export interface MothershipTurretMount {
  xFactor: number;
  yFactor: number;
  normalX: number;
  normalY: number;
}

const SIDE_TURRET_FACTORS = [-0.43, -0.25, -0.09, 0.09, 0.25, 0.43] as const;
const END_TURRET_FACTORS = [-0.24, 0.24] as const;

export const MOTHERSHIP_TURRET_MOUNTS: readonly MothershipTurretMount[] = [
  ...SIDE_TURRET_FACTORS.map((yFactor) => ({ xFactor: -0.5, yFactor, normalX: -1, normalY: 0 })),
  ...SIDE_TURRET_FACTORS.map((yFactor) => ({ xFactor: 0.5, yFactor, normalX: 1, normalY: 0 })),
  ...END_TURRET_FACTORS.map((xFactor) => ({ xFactor, yFactor: -0.5, normalX: 0, normalY: -1 })),
  ...END_TURRET_FACTORS.map((xFactor) => ({ xFactor, yFactor: 0.5, normalX: 0, normalY: 1 })),
];

export type Team = "cyan" | "magenta";
export type ShipClass =
  | "scout"
  | "needle"
  | "hive"
  | "star"
  | "chevron"
  | "lance"
  | "fork"
  | "brood"
  | "bastion"
  | "nova"
  | "prism"
  | "ram"
  | "comet"
  | "railcore"
  | "barrage"
  | "swarm"
  | "fortress"
  | "supernova"
  | "spectrum"
  | "juggernaut"
  | "interceptor"
  | "deadeye"
  | "tempest"
  | "queen"
  | "citadel"
  | "quasar"
  | "kaleidoscope"
  | "behemoth"
  | "streak";
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
    maxHp: 80,
    speed: 300,
    acceleration: 1150,
    drag: 4.2,
    radius: 15,
    cooldown: 0.26,
    bulletSpeed: 700,
    damage: 9,
  },
  needle: {
    maxHp: 88,
    speed: 285,
    acceleration: 1120,
    drag: 4,
    radius: 20,
    cooldown: 0.34,
    bulletSpeed: 820,
    damage: 14,
  },
  hive: {
    maxHp: 100,
    speed: 270,
    acceleration: 980,
    drag: 4.3,
    radius: 23,
    cooldown: 0.46,
    bulletSpeed: 550,
    damage: 8,
  },
  star: {
    maxHp: 98,
    speed: 275,
    acceleration: 1050,
    drag: 4.1,
    radius: 24,
    cooldown: 0.46,
    bulletSpeed: 620,
    damage: 7,
  },
  chevron: {
    maxHp: 108,
    speed: 335,
    acceleration: 1350,
    drag: 3.7,
    radius: 23,
    cooldown: 0.36,
    bulletSpeed: 760,
    damage: 13,
  },
  lance: {
    maxHp: 105,
    speed: 250,
    acceleration: 900,
    drag: 4,
    radius: 27,
    cooldown: 0.68,
    bulletSpeed: 1350,
    damage: 50,
  },
  fork: {
    maxHp: 94,
    speed: 310,
    acceleration: 1180,
    drag: 4.1,
    radius: 25,
    cooldown: 0.36,
    bulletSpeed: 1050,
    damage: 15,
  },
  brood: {
    maxHp: 138,
    speed: 245,
    acceleration: 900,
    drag: 4.4,
    radius: 30,
    cooldown: 0.62,
    bulletSpeed: 600,
    damage: 9,
  },
  bastion: {
    maxHp: 180,
    speed: 205,
    acceleration: 760,
    drag: 4.6,
    radius: 34,
    cooldown: 0.62,
    bulletSpeed: 650,
    damage: 30,
  },
  nova: {
    maxHp: 128,
    speed: 270,
    acceleration: 990,
    drag: 4.2,
    radius: 30,
    cooldown: 0.65,
    bulletSpeed: 610,
    damage: 9,
  },
  prism: {
    maxHp: 112,
    speed: 330,
    acceleration: 1220,
    drag: 4,
    radius: 27,
    cooldown: 0.4,
    bulletSpeed: 760,
    damage: 10,
  },
  ram: {
    maxHp: 220,
    speed: 340,
    acceleration: 1350,
    drag: 3.8,
    radius: 36,
    cooldown: 1.65,
    bulletSpeed: 0,
    damage: 90,
  },
  comet: {
    maxHp: 125,
    speed: 430,
    acceleration: 1750,
    drag: 3.5,
    radius: 31,
    cooldown: 0.58,
    bulletSpeed: 0,
    damage: 42,
  },
  railcore: {
    maxHp: 120,
    speed: 235,
    acceleration: 850,
    drag: 4.1,
    radius: 32,
    cooldown: 1.2,
    bulletSpeed: 1500,
    damage: 105,
  },
  barrage: {
    maxHp: 110,
    speed: 300,
    acceleration: 1100,
    drag: 4.1,
    radius: 30,
    cooldown: 0.34,
    bulletSpeed: 1150,
    damage: 22,
  },
  swarm: {
    maxHp: 158,
    speed: 235,
    acceleration: 860,
    drag: 4.5,
    radius: 34,
    cooldown: 0.8,
    bulletSpeed: 420,
    damage: 11,
  },
  fortress: {
    maxHp: 220,
    speed: 190,
    acceleration: 680,
    drag: 4.8,
    radius: 40,
    cooldown: 1.05,
    bulletSpeed: 350,
    damage: 30,
  },
  supernova: {
    maxHp: 150,
    speed: 255,
    acceleration: 920,
    drag: 4.3,
    radius: 35,
    cooldown: 0.72,
    bulletSpeed: 640,
    damage: 10,
  },
  spectrum: {
    maxHp: 132,
    speed: 340,
    acceleration: 1240,
    drag: 4,
    radius: 32,
    cooldown: 0.32,
    bulletSpeed: 820,
    damage: 12,
  },
  juggernaut: {
    maxHp: 280,
    speed: 330,
    acceleration: 1280,
    drag: 3.9,
    radius: 43,
    cooldown: 1.8,
    bulletSpeed: 0,
    damage: 115,
  },
  interceptor: {
    maxHp: 145,
    speed: 460,
    acceleration: 1820,
    drag: 3.45,
    radius: 37,
    cooldown: 0.52,
    bulletSpeed: 0,
    damage: 38,
  },
  deadeye: {
    maxHp: 145,
    speed: 220,
    acceleration: 790,
    drag: 4.2,
    radius: 38,
    cooldown: 1.35,
    bulletSpeed: 1700,
    damage: 135,
  },
  tempest: {
    maxHp: 130,
    speed: 295,
    acceleration: 1070,
    drag: 4.15,
    radius: 35,
    cooldown: 0.3,
    bulletSpeed: 1250,
    damage: 21,
  },
  queen: {
    maxHp: 185,
    speed: 225,
    acceleration: 810,
    drag: 4.6,
    radius: 39,
    cooldown: 0.84,
    bulletSpeed: 450,
    damage: 11,
  },
  citadel: {
    maxHp: 300,
    speed: 175,
    acceleration: 610,
    drag: 5,
    radius: 48,
    cooldown: 1.12,
    bulletSpeed: 360,
    damage: 34,
  },
  quasar: {
    maxHp: 180,
    speed: 245,
    acceleration: 860,
    drag: 4.4,
    radius: 41,
    cooldown: 0.82,
    bulletSpeed: 680,
    damage: 10,
  },
  kaleidoscope: {
    maxHp: 152,
    speed: 350,
    acceleration: 1260,
    drag: 4,
    radius: 38,
    cooldown: 0.29,
    bulletSpeed: 880,
    damage: 11,
  },
  behemoth: {
    maxHp: 360,
    speed: 315,
    acceleration: 1200,
    drag: 4,
    radius: 52,
    cooldown: 2,
    bulletSpeed: 0,
    damage: 145,
  },
  streak: {
    maxHp: 170,
    speed: 500,
    acceleration: 1950,
    drag: 3.35,
    radius: 44,
    cooldown: 0.46,
    bulletSpeed: 0,
    damage: 36,
  },
};

export type WeaponMode = "bolt" | "rail" | "fork" | "drone" | "radial" | "fan" | "dash";

export interface WeaponProfile {
  mode: WeaponMode;
  count: number;
  spread: number;
  pierce: number;
  miningMultiplier: number;
  dashDuration: number;
  dashImpulse: number;
}

const weapon = (
  mode: WeaponMode,
  count = 1,
  spread = 0,
  pierce = 1,
  miningMultiplier = 1,
  dashDuration = 0,
  dashImpulse = 0,
): WeaponProfile => ({ mode, count, spread, pierce, miningMultiplier, dashDuration, dashImpulse });

export const SHIP_WEAPONS: Record<ShipClass, WeaponProfile> = {
  scout: weapon("bolt"),
  needle: weapon("bolt"),
  hive: weapon("fan", 2, 0.18),
  star: weapon("fan", 3, 0.36),
  chevron: weapon("bolt"),
  lance: weapon("rail", 1, 0, 2),
  fork: weapon("fork", 2, 0.11, 1, 1.1),
  brood: weapon("fan", 4, 0.72),
  bastion: weapon("bolt", 1, 0, 1, 1.35),
  nova: weapon("radial", 6),
  prism: weapon("fan", 4, 0.5),
  ram: weapon("dash", 1, 0, 1, 1.6, 460, 760),
  comet: weapon("dash", 1, 0, 1, 1.15, 190, 430),
  railcore: weapon("rail", 1, 0, 9, 1.15),
  barrage: weapon("fork", 3, 0.18, 3, 1.25),
  swarm: weapon("fan", 6, 1.02),
  fortress: weapon("fan", 3, 0.52, 1, 1.45),
  supernova: weapon("radial", 16),
  spectrum: weapon("fan", 7, 0.78),
  juggernaut: weapon("dash", 1, 0, 1, 1.8, 520, 850),
  interceptor: weapon("dash", 1, 0, 1, 1.2, 170, 470),
  deadeye: weapon("rail", 1, 0, 12, 1.25),
  tempest: weapon("fork", 4, 0.24, 4, 1.3),
  queen: weapon("drone", 12, 1.24, 1, 1.8),
  citadel: weapon("drone", 5, 0.64, 2, 2),
  quasar: weapon("radial", 20),
  kaleidoscope: weapon("fan", 9, 0.92),
  behemoth: weapon("dash", 1, 0, 1, 2, 600, 940),
  streak: weapon("dash", 1, 0, 1, 1.25, 150, 520),
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
  research: number;
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
  vx: number;
  vy: number;
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
  team?: Team;
}

export interface SalvageSnapshotMessage {
  type: "salvageSnapshot";
  sequence: number;
  salvage: SalvageView[];
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
  kind:
    | "asteroidHit"
    | "asteroidBreak"
    | "shipHit"
    | "shipBreak"
    | "baseHit"
    | "dashHit"
    | "pickup";
  x: number;
  y: number;
  team?: Team;
  intensity: number;
}

export const TEAM_COLORS: Record<Team, string> = {
  cyan: "#63fff3",
  magenta: "#ff5eaa",
};

export const CLASS_COST = 120;
export const ADVANCED_CLASS_COST = 220;
export const ELITE_CLASS_COST = 300;
export const APEX_CLASS_COST = 400;
export const MAX_STAT_LEVEL = 7;
export const TIER_ONE_CLASSES = ["needle", "hive", "star", "chevron"] as const;
export const CLASS_UPGRADE_OPTIONS: Partial<Record<ShipClass, readonly ShipClass[]>> = {
  scout: TIER_ONE_CLASSES,
  needle: ["lance", "fork"],
  hive: ["brood", "bastion"],
  star: ["nova", "prism"],
  chevron: ["ram", "comet"],
  lance: ["railcore"],
  fork: ["barrage"],
  brood: ["swarm"],
  bastion: ["fortress"],
  nova: ["supernova"],
  prism: ["spectrum"],
  ram: ["juggernaut"],
  comet: ["interceptor"],
  railcore: ["deadeye"],
  barrage: ["tempest"],
  swarm: ["queen"],
  fortress: ["citadel"],
  supernova: ["quasar"],
  spectrum: ["kaleidoscope"],
  juggernaut: ["behemoth"],
  interceptor: ["streak"],
};

export const SHIP_CLASS_INFO: Record<ShipClass, { description: string; tier: number }> = {
  scout: { description: "BALANCED STARTER FRAME", tier: 0 },
  needle: { description: "PRECISION CANNON · RAIL BRANCH", tier: 1 },
  hive: { description: "TWIN POD VOLLEY · DRONE BRANCH", tier: 1 },
  star: { description: "TRI-BOLT SPREAD · BURST BRANCH", tier: 1 },
  chevron: { description: "FAST ASSAULT FRAME · DASH BRANCH", tier: 1 },
  lance: { description: "EARLY RAIL · 2 PIERCE", tier: 2 },
  fork: { description: "TWIN LIGHT PENETRATORS", tier: 2 },
  brood: { description: "FOUR-POD HUNTING VOLLEY", tier: 2 },
  bastion: { description: "ARMORED HEAVY CANNON", tier: 2 },
  nova: { description: "SIX-WAY RADIAL BURST", tier: 2 },
  prism: { description: "FOCUSED FOUR-BOLT FAN", tier: 2 },
  ram: { description: "HEAVY SIEGE CHARGE", tier: 2 },
  comet: { description: "RAPID CHAIN DASH", tier: 2 },
  railcore: { description: "HYPERVELOCITY 9-PIERCE SHOT", tier: 3 },
  barrage: { description: "TRIPLE PENETRATOR ARRAY", tier: 3 },
  swarm: { description: "SIX-POD SATURATION FAN", tier: 3 },
  fortress: { description: "TRIPLE SIEGE BATTERY", tier: 3 },
  supernova: { description: "SIXTEEN-WAY ORBITAL BURST", tier: 3 },
  spectrum: { description: "SEVEN-BOLT FOCUS FAN", tier: 3 },
  juggernaut: { description: "ARMORED IMPACT ENGINE", tier: 3 },
  interceptor: { description: "HIGH-FREQUENCY CHAIN DASH", tier: 3 },
  deadeye: { description: "APEX SCREEN · 12-PIERCE RAIL", tier: 4 },
  tempest: { description: "APEX SCREEN · QUAD RAIL STORM", tier: 4 },
  queen: { description: "APEX SCREEN · 12 HOMING DRONES", tier: 4 },
  citadel: { description: "APEX SCREEN · 5 HEAVY SENTINELS", tier: 4 },
  quasar: { description: "APEX SCREEN · 20-WAY BARRAGE", tier: 4 },
  kaleidoscope: { description: "APEX SCREEN · 9-BOLT FAN", tier: 4 },
  behemoth: { description: "APEX SCREEN · MAXIMUM CHARGE", tier: 4 },
  streak: { description: "APEX SCREEN · ULTRA-DASH", tier: 4 },
};

export const TRANSFORM_RESEARCH = [0, 160, 480, 900, 1500] as const;
export const TRANSFORM_COSTS = [
  0,
  CLASS_COST,
  ADVANCED_CLASS_COST,
  ELITE_CLASS_COST,
  APEX_CLASS_COST,
] as const;
export const STAT_BONUSES = {
  weaponDamagePerLevel: 0.04,
  weaponRatePerLevel: 0.03,
  enginePerLevel: 0.03,
  hullPerLevel: 0.05,
  miningDamagePerLevel: 0.06,
  miningRadiusPerLevel: 4,
} as const;

export function statCost(level: number): number {
  return 55 + level * 22;
}

export function shipTransformTier(shipClass: ShipClass): number {
  return SHIP_CLASS_INFO[shipClass].tier;
}

export function previousShipClass(shipClass: ShipClass): ShipClass | undefined {
  for (const current of Object.keys(CLASS_UPGRADE_OPTIONS) as ShipClass[]) {
    if (CLASS_UPGRADE_OPTIONS[current]?.includes(shipClass)) return current;
  }
  return undefined;
}

export function classUpgradeCost(current: ShipClass, target: ShipClass): number | undefined {
  if (!CLASS_UPGRADE_OPTIONS[current]?.includes(target)) return undefined;
  return TRANSFORM_COSTS[shipTransformTier(target)];
}

export function classResearchRequirement(
  current: ShipClass,
  target: ShipClass,
): number | undefined {
  if (!CLASS_UPGRADE_OPTIONS[current]?.includes(target)) return undefined;
  return TRANSFORM_RESEARCH[shipTransformTier(target)];
}
