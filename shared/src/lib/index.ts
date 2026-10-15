// @chudlog/shared — PURE RULE FUNCTIONS ONLY.
// No I/O, no env reads, no Date.now(). Deterministic: same inputs, same
// outputs, so api and web import the same truth and tests run in both.
//
// The week-1 skeleton ships the modules below; streak.js (restore logic) and
// the nudge state machine land in week 3 on top of these.
export * as calendar from './calendar.js';
export * as sleep from './sleep.js';
export * as points from './points.js';
export * as tdee from './tdee.js';
export * as protein from './protein.js';
export * as e1rm from './e1rm.js';
export * as normalize from './normalize.js';
export * as season from './season.js';
export { ChudError } from './types.js';
export type * from './types.js';
export const VERSION = 1;

export * as ladder from './ladder.js';
export * as flame from './flame.js';
