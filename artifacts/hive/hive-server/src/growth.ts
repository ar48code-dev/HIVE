import type { AuditEntry } from './repo.js';

export interface Achievement { id: string; title: string; hint: string; done: boolean }
export interface Growth { cells: number; capacity: number; achievements: Achievement[] }

const REVIEW_EVENTS = new Set(['alert_reviewed', 'alert_dismissed']);
const CARE_EVENTS = new Set(['alert_reviewed', 'alert_dismissed', 'action_approved', 'action_rejected', 'wasplab_run', 'answered', 'attack_simulated']);

/**
 * The colony grows when you look after your finances: reviewing alerts, deciding on proposals,
 * asking questions, testing your defences. Nothing here rewards spending or taking risks.
 */
export function growth(audit: AuditEntry[], openAlerts: number, capacity = 19): Growth {
  const count = (pred: (e: AuditEntry) => boolean) => audit.filter(pred).length;
  const reviews = count((e) => REVIEW_EVENTS.has(e.event));
  const achievements: Achievement[] = [
    { id: 'first_review', title: 'First look', hint: 'Review or dismiss an alert', done: reviews >= 1 },
    { id: 'five_reviews', title: 'Steady keeper', hint: 'Review five alerts', done: reviews >= 5 },
    { id: 'decided', title: 'Steady hand', hint: 'Approve or reject a proposed action', done: count((e) => e.event === 'action_approved' || e.event === 'action_rejected') >= 1 },
    { id: 'asked', title: 'Curious', hint: 'Ask Queen a question', done: count((e) => e.event === 'answered') >= 1 },
    { id: 'lab', title: 'Tester', hint: 'Run Wasp Lab', done: count((e) => e.event === 'wasplab_run') >= 1 },
    { id: 'clear', title: 'Clear skies', hint: 'Have no open alerts', done: openAlerts === 0 },
  ];
  return { cells: Math.min(capacity, count((e) => CARE_EVENTS.has(e.event))), capacity, achievements };
}
