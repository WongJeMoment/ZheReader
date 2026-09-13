// Reserve a slot before starting a Codex turn; cancelled selections never start later.
export class TaskQueue {
  constructor(limit = 4, maxWaiting = 32) {
    this.limit = limit;
    this.maxWaiting = maxWaiting;
    this.active = 0;
    this.waiting = [];
  }
  acquire(signal) {
    if (signal?.aborted)
      return Promise.reject(new DOMException("请求已取消", "AbortError"));
    if (this.active >= this.limit && this.waiting.length >= this.maxWaiting)
      return Promise.reject(
        Object.assign(new Error("等待任务较多，请停止不需要的任务后重试。"), {
          status: 429,
        }),
      );
    return new Promise((resolve, reject) => {
      const entry = {
        start: () => {
          signal?.removeEventListener("abort", abort);
          this.active++;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            this.active--;
            this.waiting.shift()?.start();
          });
        },
      };
      const abort = () => {
        const index = this.waiting.indexOf(entry);
        if (index !== -1) this.waiting.splice(index, 1);
        reject(new DOMException("请求已取消", "AbortError"));
      };
      if (this.active < this.limit) entry.start();
      else {
        this.waiting.push(entry);
        signal?.addEventListener("abort", abort, { once: true });
      }
    });
  }
}
