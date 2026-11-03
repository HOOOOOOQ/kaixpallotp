// Transitions require verified provider evidence where applicable; this table alone is not authorization.
const transitions = Object.freeze({
  CREATED: ['VALIDATING'], VALIDATING: ['PROCESSING', 'FAILED'],
  PROCESSING: ['PENDING', 'OTP_RECEIVED', 'FAILED', 'UNKNOWN'],
  UNKNOWN: ['PENDING', 'OTP_RECEIVED', 'FAILED', 'EXPIRED', 'CANCELLED'],
  PENDING: ['OTP_RECEIVED', 'FAILED', 'EXPIRED', 'CANCELLATION_REQUESTED', 'UNKNOWN'],
  CANCELLATION_REQUESTED: ['CANCELLED', 'PENDING', 'OTP_RECEIVED', 'EXPIRED', 'UNKNOWN'],
  OTP_RECEIVED: ['COMPLETED'], COMPLETED: [], FAILED: [], EXPIRED: [], CANCELLED: []
});
export function canTransition(from, to) {
  return Object.hasOwn(transitions, from) && transitions[from].includes(to);
}
export function assertTransition(from, to) {
  if (!canTransition(from, to)) throw new Error(`Invalid order transition: ${from} -> ${to}`);
}
