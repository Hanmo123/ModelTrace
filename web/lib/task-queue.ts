/** One keyed queue for single-model and batch tests; duplicate clicks join a task. */
export function createTaskQueue<T>(concurrency: number) {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error("Invalid concurrency");
  const pending: Array<() => void> = [];
  const tasks = new Map<string, Promise<T>>();
  let active = 0;

  function drain() {
    while (active < concurrency && pending.length) {
      active++;
      pending.shift()!();
    }
  }

  function enqueue(key: string, task: () => Promise<T>): Promise<T> {
    const existing = tasks.get(key);
    if (existing) return existing;
    let start!: () => void;
    const promise = new Promise<T>((resolve, reject) => {
      start = () => {
        const finish = () => {
          tasks.delete(key);
          active--;
          drain();
        };
        Promise.resolve()
          .then(task)
          .then(
            (value) => {
              finish();
              resolve(value);
            },
            (error) => {
              finish();
              reject(error);
            },
          );
      };
    });
    tasks.set(key, promise);
    pending.push(start);
    drain();
    return promise;
  }

  return { enqueue, has: (key: string) => tasks.has(key) };
}
