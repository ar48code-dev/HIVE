# The animated hive: design notes

## Idea
HIVE's story is a colony: **your money is the honey, the Queen (Queen AI) watches the hive, and alerts are wasps**. Eighteen small worker bees patrol the landing page as a decorative brand animation; they are not payment records.

| You see | It means |
|---|---|
| Small worker bees patrol the landing page | Decorative motion only; no transaction is implied |
| A bee flies in carrying honey and a cell lights up | A payment arrived |
| A wasp prowls outside the shield | An open alert (one wasp per two alerts, up to five); the landing-page alert wasps are clickable |
| The shield flares | A new alert was raised |
| Wasps hit the shield and spark | They are held outside it; the shield never lets one in |
| Attack sequence: wasps stream in, shield bursts, guards sweep out | A simulated attack was launched and HIVE caught it after N of M transactions |
| Wasps reach the hive, no shield burst, "Not caught" | A simulated attack HIVE did not catch |

## Principles
1. **Honest.** The attack sequence is driven by the real outcome. The catch happens after the number of transactions HIVE actually needed. `../tests/motion.test.ts` includes tests that fail if a catch is ever shown for an attack that was not caught.
2. **Optional.** Calm mode (or the system reduce-motion setting) shows a still picture and turns off every animation. It is remembered, and it stops a running sequence at once.
3. **Meaningful without the picture.** Counts of payments and alerts are real text, the canvas is hidden from assistive technology, and results also appear as normal notices.
4. **Light.** One canvas, one animation loop, a capped number of creatures, device pixel ratio capped at 2, paused when off-screen or when the tab is hidden. Measured in software-rendered headless Chromium at about 57 frames per second.
5. **Original.** Every bee, wasp, crown and cell is drawn in code. No external images, fonts for the art, or music.
6. **No moving click targets.** The honeycomb shimmers by changing brightness, never size or position.

## Where things are
- `../../src/hive/motion/sim.ts`: the Hive scene simulation (flight, arrivals, shield, wasps). Pure logic.
- `../../src/hive/motion/theater.ts`: the attack sequence simulation. Pure logic.
- `../../src/hive/motion/draw.ts`: the hand-drawn bee, queen and wasp.
- `../../src/hive/motion/HiveScene.tsx`, `AttackTheater.tsx`: the canvas components.
- `../../src/hive/motion/bus.ts`: how screens tell the scenes what happened (payment, alert, attack).
- `../../src/hive/motion/prefs.ts`: the Calm / full setting.

## Recording the demo video
Keep Motion on "full". Launch an attack from Wasp Lab for the strongest moment (it takes about five seconds). Press Escape or "Skip animation" to cut it short if needed.
