/**
 *  Error indicating that the `Promeister` has been canceled.
 */
export default class CanceledError extends Error {
  constructor() {
    super('Process has been canceled.')
    this.name = 'CanceledError'
  }
}
