// Zod payload schemas (private handoff §0.10: Zod on every write, explicit
// bounds). Shared by all route modules.

import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().min(3).max(254).email();
export const passwordSchema = z.string().min(8).max(256);
export const displayNameSchema = z.string().trim().min(1).max(24);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  display_name: displayNameSchema,
  tz: z.string().max(64).default('Asia/Jakarta'),
  group_create: z.object({ name: z.string().trim().min(1).max(40) }).optional(),
  group_join: z.object({ code: z.string().trim().toUpperCase().length(8) }).optional(),
}).refine((v) => Boolean(v.group_create) !== Boolean(v.group_join), {
  message: 'exactly one of group_create or group_join is required',
});

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(256) });

export const inviteCodeSchema = z.string().trim().length(8);

export const sleepSchema = z.object({
  bed_ts: z.number().int().min(0),
  wake_ts: z.number().int().min(0),
});

export const mealLabelSchema = z.string().trim().max(30).optional();

export const mealRowSchema = z.object({
  name: z.string().trim().min(1).max(60),
  amount: z.string().trim().min(1).max(60),
  kcal: z.number().finite().min(0).max(20000),
  protein_g: z.number().finite().min(0).max(3000),
  carbs_g: z.number().finite().min(0).max(3000).optional(),
  fat_g: z.number().finite().min(0).max(3000).optional(),
  micros: z.record(z.unknown()).optional(),
  source_food_id: z.string().uuid().optional(),
});

export const createMealSchema = z.object({ label: mealLabelSchema, idempotency_key: z.string().trim().min(8).max(64).optional() });
export const replaceMealRowsSchema = z.object({ label: mealLabelSchema, rows: z.array(mealRowSchema).min(1).max(100), idempotency_key: z.string().trim().min(8).max(64).optional() });
export const appendMealRowSchema = z.object({ row: mealRowSchema, idempotency_key: z.string().trim().min(8).max(64).optional() });

export const savedFoodSchema = z.object({
  name: z.string().trim().min(1).max(60),
  default_amount: z.string().trim().min(1).max(60),
  kcal: z.number().finite().min(0).max(20000),
  protein_g: z.number().finite().min(0).max(3000),
  carbs_g: z.number().finite().min(0).max(3000).optional(),
  fat_g: z.number().finite().min(0).max(3000).optional(),
  micros: z.record(z.unknown()).optional(),
});
export const foodCopySchema = z.object({ id: z.string().uuid() });
export const foodSearchSchema = z.object({ q: z.string().trim().min(1).max(80) });

export const setItemSchema = z.object({ kg: z.number().finite().min(0).max(1000).nullable(), reps: z.number().int().min(1).max(60), rir: z.enum(['0', '1', '2', '3+']).optional(), warmup: z.boolean().optional() });
export const exerciseBlockSchema = z.object({
  exercise: z.string().trim().min(1).max(80),
  muscle: z.string().trim().min(1).max(60),
  sets: z.array(setItemSchema).min(1).max(40),
});
export const workoutSchema = z.object({
  started_ts: z.number().int().min(0),
  duration_min: z.number().int().min(0).max(720).optional(),
  exercises: z.array(exerciseBlockSchema).min(1).max(100),
  label: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
  idempotency_key: z.string().trim().min(8).max(64).optional(),
});
export const workoutFinishSchema = z.object({
  duration_min: z.number().int().min(1).max(720).optional(),
  notes: z.string().trim().max(500).optional(),
  idempotency_key: z.string().trim().min(8).max(64).optional(),
});
export const restSchema = z.object({
  reason: z.string().trim().max(50).optional(),
  idempotency_key: z.string().trim().min(8).max(64).optional(),
});

export const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(40).max(512), auth: z.string().min(16).max(128) }),
  user_agent: z.string().max(512).optional(),
});

export const profileUpdateSchema = z.object({
  display_name: z.string().trim().min(1).max(24).optional(),
  sex: z.enum(['m', 'f']).nullish(),
  age: z.number().int().min(1).max(120).nullish(),
  height_cm: z.number().int().min(90).max(250).nullish(),
  bodyweight_kg: z.number().finite().min(20).lt(400).nullish(),
  bar_weight_kg: z.number().finite().min(0).max(50).optional(),
  plates_kg: z.array(z.number().positive().max(100)).max(20).optional(),
  activity_factor: z.enum(['1.2', '1.375', '1.55', '1.725', '1.9']).optional(),
  calorie_goal_mode: z.enum(['maintain', 'mild', 'loss', 'extreme', 'custom']).optional(),
  calorie_goal: z.number().int().positive().max(20000).optional(),
});
