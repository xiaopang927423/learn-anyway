// Reserve interactive input capacity; queued work has a deadline and can be canceled.
class ModelRequestQueue {
  constructor(limit = 4) { this.limit = limit; this.active = 0; this.pages = 0; this.pending = []; this.turn = 0 }
  run(kind, task, { signal, deadline = Date.now() + 45000 } = {}) {
    return new Promise((resolve, reject) => {
      const job = { kind, task, resolve, reject, signal, deadline }
      const cancel = () => {
        const i = this.pending.indexOf(job)
        if (i >= 0) { this.pending.splice(i, 1); job.cleanup(); reject(Object.assign(new Error('请求已取消或超时'), { code: 'TIMEOUT' })) }
      }
      const timer = setTimeout(cancel, Math.max(1, deadline - Date.now()))
      job.cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) { job.cleanup(); reject(Object.assign(new Error('请求已取消'), { code: 'TIMEOUT' })); return }
      if (this.pending.length >= 64) { job.cleanup(); reject(Object.assign(new Error('请求较多'), { code: 'BUSY' })); return }
      this.pending.push(job); this.drain()
    })
  }
  drain() {
    while (this.active < this.limit) {
      // Page jobs may use at most two slots and never the final reserved input slot.
      const eligible = this.pending.filter(j => j.kind !== 'page' || this.pages < 2 && this.active < this.limit - 1)
      if (!eligible.length) return
      const kinds = ['ime', 'lookup', 'page']
      let job
      for (let n = 0; n < kinds.length; n++) {
        const k = (this.turn + n) % kinds.length
        job = eligible.find(j => j.kind === kinds[k])
        if (job) { this.turn = (k + 1) % kinds.length; break }
      }
      job ||= eligible[0]
      this.pending.splice(this.pending.indexOf(job), 1); job.cleanup()
      if (job.signal?.aborted || Date.now() >= job.deadline) { job.reject(Object.assign(new Error('请求超时'), { code: 'TIMEOUT' })); continue }
      this.active++; if (job.kind === 'page') this.pages++
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => {
        this.active--; if (job.kind === 'page') this.pages--; this.drain()
      })
    }
  }
}
module.exports = { ModelRequestQueue, modelQueue: new ModelRequestQueue() }
