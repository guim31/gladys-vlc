// -----------------------------------------------------------------------------
// Repeated failures, logged once (the gladys-subsonic pattern).
//
// A VLC closed for the evening is polled every 30 s, Gladys refusing states is
// retried at every read: each would write the same warning again and again.
// An issue log keeps, per key, whether the problem is ongoing: the first
// failure is a warning, the next ones go to debug, and the recovery is one
// info line.
// -----------------------------------------------------------------------------

/**
 * @param {{ debug: Function, info: Function, warn: Function }} logger
 */
export function createIssueLog(logger) {
  const ongoing = new Set();
  return {
    /**
     * Report a failure: a warning the first time, debug while it lasts.
     * @param {string} key what failed (one key per independent problem)
     * @param {string} message
     */
    fail(key, message) {
      if (ongoing.has(key)) {
        logger.debug(`${message} (still failing)`);
        return;
      }
      ongoing.add(key);
      logger.warn(message);
    },

    /**
     * Report a success: one info line when it ends an ongoing failure.
     * @param {string} key
     * @param {string} message said on recovery only
     * @returns {boolean} whether a failure ended
     */
    ok(key, message) {
      if (ongoing.delete(key)) {
        logger.info(message);
        return true;
      }
      return false;
    },
  };
}
