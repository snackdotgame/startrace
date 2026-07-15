# Star Trace balance contract

Star Trace should feel like a readable vector dogfight where mining creates risk, returning cargo
creates progression, transformations change play style, and an enemy mothership is a clearly marked
lethal exclusion zone.

## Current tuning hypotheses

- A scout mirror duel takes about 2.1 seconds from the first direct hit to destruction under
  sustained perfect fire. Missing, maneuvering, and asteroid cover should extend that time.
- The first transformation requires 160 research and 120 banked salvage. Later transformation
  requirements rise to 480/220, 900/300, and 1500/400.
- Enemy motherships acquire lock in 0.2 seconds, fire a player volley every 0.5 seconds, and launch
  1650-unit-per-second defense bolts. A cannon hit still destroys a starter frame, while damage
  falls by transformation tier. Every apex frame requires at least 17 direct cannon hits, creating
  a minimum eight-second siege window after the first impact when every volley connects.
- Apex frames carry a visible siege screen and are the only frames with homing weapons. Early
  transformations establish branch direction through handling and shot geometry; signature rails,
  radial bursts, dashes, and autonomous weapons arrive progressively in later tiers.
- Destroyed ships reconstruct at their mothership after a visible four-second countdown.
- Destroying a ship exposes its carried cargo plus a bounty based on its transformation tier and
  stat investment. The drops use the destroyed ship's team color but remain collectible by either
  team, making the wreck site a readable recovery or contest objective.
- Death removes one transformation tier and up to two invested stat levels. Banked salvage and
  accumulated research remain safe, so the setback is meaningful without resetting the whole run.
- Salvage visibility is independent from the crowded combat snapshot. A bounded 10 Hz binary
  replacement packet carries nearby salvage across the full camera envelope, and the client only
  culls it once it is actually outside the screen.
- Transformations retain their distinct mechanics. Tune range, cadence, speed, cost, exposure, and
  counterplay before flattening their damage into the same profile.

## Evidence collected each round

The authoritative server emits a bounded `[balance]` JSON report every 60 seconds and at match end.
It includes:

- deposits and salvage banked by team;
- first transformation, first player kill, and first player-inflicted mothership damage;
- player kills and player/asteroid mothership damage by team;
- mothership cannon shots, asteroid/player hits, kills, and average warning-to-hit time;
- class selections, player damage, mothership damage, kills, and deaths.

Treat these as investigation signals rather than automatic nerf triggers. Segment observations by
player count and match duration, then pair the numbers with playtest notes about clarity, fairness,
and whether each death had a recognizable counterplay option.

## Balance review order

1. Fix unreadable or unavoidable deaths.
2. Check progression pacing and whether the first transformation predicts the winner.
3. Remove mandatory and abandoned class branches while preserving their identities.
4. Tune individual matchups only after the large class and economy outliers are understood.

Starting alarms are a side win rate outside 47–53%, a comparable branch above 70% or below 10% pick
rate, or the first transformation predicting victory above roughly 70%. These require enough matches
to be meaningful and should trigger investigation, not an automatic numerical change.
