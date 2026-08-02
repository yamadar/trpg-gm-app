import { AsyncLocalStorage } from 'node:async_hooks';

export function createSqliteCoordinator(db, { now = Date.now } = {}) {
  const transactionContext = new AsyncLocalStorage();
  let queue = Promise.resolve();
  const metrics = {
    operations: 0,
    transactions: 0,
    rollbacks: 0,
    busyErrors: 0,
    totalTransactionMs: 0,
    maxTransactionMs: 0,
  };

  function recordError(error) {
    if (error?.code === 'ERR_SQLITE_ERROR' && /SQLITE_BUSY|database is locked/i.test(error.message || '')) {
      metrics.busyErrors += 1;
    }
  }

  function enqueue(operation) {
    const result = queue.catch(() => {}).then(operation);
    queue = result.catch(() => {});
    return result;
  }

  async function run(operation) {
    if (transactionContext.getStore()) {
      metrics.operations += 1;
      try {
        return operation();
      } catch (error) {
        recordError(error);
        throw error;
      }
    }
    return enqueue(() => {
      metrics.operations += 1;
      try {
        return operation();
      } catch (error) {
        recordError(error);
        throw error;
      }
    });
  }

  async function transaction(operation, { mode = 'immediate' } = {}) {
    if (transactionContext.getStore()) return operation();
    return enqueue(async () => {
      const startedAt = now();
      metrics.transactions += 1;
      db.exec(mode === 'deferred' ? 'BEGIN' : 'BEGIN IMMEDIATE');
      try {
        const value = await transactionContext.run({ active: true }, operation);
        db.exec('COMMIT');
        return value;
      } catch (error) {
        metrics.rollbacks += 1;
        try {
          db.exec('ROLLBACK');
        } catch {
          // 元の例外を優先する。接続破損は次のreadiness検査でも検出される。
        }
        recordError(error);
        throw error;
      } finally {
        const elapsed = Math.max(0, now() - startedAt);
        metrics.totalTransactionMs += elapsed;
        metrics.maxTransactionMs = Math.max(metrics.maxTransactionMs, elapsed);
      }
    });
  }

  return {
    run,
    transaction,
    snapshotMetrics() {
      return { ...metrics };
    },
  };
}
