/* ==========================================================================
   lock.js — runs state-changing operations one at a time
   --------------------------------------------------------------------------
   Paying, starting a trial, cancelling a subscription and changing the cart
   all read the database, decide, and then write. Two of them running at the
   same moment could both see "1 unit left" and both succeed. MongoDB itself
   offers multi-document transactions only on replica sets, so instead this
   server (a single Node.js process) keeps a queue: each operation starts
   when the previous one has finished.

   Limit: it protects ONE server process. Running several copies behind a
   load balancer would need a database-level lock or transactions.
   ========================================================================== */

let tail = Promise.resolve();

function exclusive(task) {
    const run = tail.then(task);
    tail = run.catch(() => {});      // a failure must not block the queue
    return run;                      // but the caller still receives it
}

module.exports = { exclusive };
