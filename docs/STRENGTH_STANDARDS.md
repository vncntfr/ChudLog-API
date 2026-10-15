# Strength reference methodology

Use this reference to interpret the Ladder view. Version: `chudlog-estimated-bw-2026-10-15-v1`.

The four reference families use the five broad bodyweight ratios from Strength Level's own community tables: [bench press](https://strengthlevel.com/strength-standards/bench-press), [squat](https://strengthlevel.com/strength-standards/squat), [deadlift](https://strengthlevel.com/strength-standards/deadlift), and [shoulder press](https://strengthlevel.com/strength-standards/shoulder-press). The tables were consulted on 2026-10-15. These are community strength references, not clinical standards.

ChudLog maps those five levels to scores 1, 250, 500, 750, and 1000. **Every variation multiplier is a ChudLog estimate**, including machine and pulling variations. The reference family source does not validate those multipliers. The exact 50 names, family mappings, multipliers, and total/per-hand conventions live in `shared/src/lib/ladder.ts`.

The API uses the owner's selected calculation sex and current bodyweight, plus the best estimated maximum from eligible working sets of 1–12 repetitions. Missing profile inputs produce a setup prompt. Bodyweight-only exercises have no invented external load. Warmups do not contribute. Historical scores can change when profile bodyweight changes; they aren't frozen meet records.

Log the displayed load convention consistently. Machine ratios cannot reliably compare different equipment. Per-hand dumbbell loads are not the combined pair. The 1–1000 score is a versioned app scale, not a measured population percentile, and should remain labeled estimated until the owner approves a stronger exercise-specific dataset.
