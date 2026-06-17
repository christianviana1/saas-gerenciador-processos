/**
 * Queue Schedulers
 *
 * Central export for all BullMQ cron/repeatable job schedulers.
 * Import and call each scheduler function during server startup
 * to register all background repeating jobs.
 *
 * Registered schedulers:
 *  - scheduleDataJudCron    : daily DataJud process sync (02:00 UTC, Req 7.2)
 *  - scheduleRetentionCron  : daily LGPD data retention check (03:00 UTC, Req 13.5)
 */

export { scheduleDataJudCron } from './datajudCronScheduler';
export { scheduleRetentionCron } from '@/infrastructure/queues/retentionScheduler';
