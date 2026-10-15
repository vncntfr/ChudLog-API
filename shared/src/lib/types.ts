// Pure types shared across calendar/sleep/points.

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number; // 0-59
  /** minutes past local midnight — the unit window checks compare against */
  minutesOfDay: number;
  /** Monday=1 .. Sunday=7 */
  isoWeekday: number;
  /** 'YYYY-MM-DD' local calendar date */
  date: string;
  /** reserved: DST status for future public DST tests */
  dst?: boolean;
}

export type SleepColor = 'green' | 'yellow' | 'red';

export class ChudError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ChudError';
  }
}
