/**
 *  Error indicating the `Promeister` has been timed out.
 */
export default class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Process has been timed out after ${ms}ms.`)
    this.name = 'TimeoutError'
  }
}
