import type { AnyFunction, OnResolved, OnRejected, Rejector, Resolver, SimpleVoidFunction } from 'typestar'
import { Bitmap, createBitmapStates } from 'bitbob'
import CanceledError from './CanceledError'
import TimeoutError from './TimeoutError'

const State = createBitmapStates(['Resolved', 'Rejected', 'Canceled', 'Timeout', 'Interrupted'])

/**
 *  Type describing the types of a `PromeisterEvent`.
 */
export type EventType = 'cancel' | 'interrupt' | 'timeout'

/**
 *  Callback describing the callback used to instantiate a new `Promeister`. The only difference to a normal promise callback is the third callback type
 *  handling a `PromeisterEvent`.
 */
export type PromeisterCallback<T, D> = (resolve: Resolver<T>, reject: Rejector, onEvent: (cancelHandler: PromeisterEventHandler<D>) => void) => void

/**
 *  Object containing the metadata of the triggered event.
 */
export interface PromeisterEvent<D> {
  /** Data passed from the event */
  data?: D
  /** Signal of the internal `AbortController` */
  signal?: AbortSignal
  /** The type of the triggered event */
  type: EventType
}

/**
 *  Callback describing the `onEvent` callback passed into the `Promeister` constructor. It handles an `PromeisterEvent` object.
 */
export type PromeisterEventHandler<D> = (e: PromeisterEvent<D>) => void

/**
 *  Internal structures used as memory for the Promeister
 */
export interface PromeisterInternals {
  /** Array holding all event callbacks found inside the Promeister */
  onEventList: AnyFunction[]
  /** Internal state handler structure */
  state: Bitmap
}

/**
 *  Main options for the Promeister creation.
 */
export interface PromeisterOptions<T> {
  /** External AbortController able to cancel the Promise */
  controller?: AbortController
  /** Amount of time to wait before starting the process. On retry, you can choose the delay for each attempt. */
  delay?: number | ((attempt: number) => number)
  /** internal structures used as memory for the Promeister */
  internals?: PromeisterInternals
  /** Promise to be converted into a Promeister */
  promise?: Promise<T>
  /** Maximum duration before cancellation  */
  timeout?: number
  /** Amount of retries before entirely giving up trying to fulfill the promise. */
  tries?: number
}

/* eslint-disable ts/no-empty-function */
const noop = (): undefined => {}
/* eslint-enable ts/no-empty-function */

/**
 *  Generates the default internals for the Promeister memory.
 *
 *  @returns the default `PromeisterInternals`.
 */
export function defaultInternals(): PromeisterInternals {
  return { onEventList: [], state: new Bitmap() }
}

/**
 *  Parses the delay for the current promise execution.
 *
 *  @param options - passed in options for the `Promeister` creation.
 *  @param attempt - the current retry attempt, if applicable.
 *  @returns the delay for the current execution.
 */
function getDelay<T>(options: PromeisterOptions<T>, attempt: number): number {
  return typeof options.delay === 'function' ? options.delay(attempt) : options.delay ?? 0
}

/**
 *  Runs all callbacks.
 *
 *  @param callbacks The list of callbacks stored inside the `Promeister`.
 */
function runCallbacks(callbacks: unknown[]): void {
  for (const callback of callbacks) {
    if (typeof callback === 'function') {
      callback()
    }
  }
}

/**
 *  Delays a promise.
 *
 *  @param ms the amount of time to delay.
 */
async function sleep(ms: number): Promise<void> {
  await new Promise(r => setTimeout(r, ms))
}

const AbortOptions: AddEventListenerOptions = { once: true }

/**
 *  Transforms a list of promises into from a static `Promeister` function into a cancelable list of promises.
 *
 * @param signal - the signal used in the overarching `Promeister` static method.
 * @param iterable - the list of promises.
 * @param promise - the overarching promise used for the static method.
 * @returns
 */
function makeAllCancelable<T, P>(signal: AbortSignal, iterable: Iterable<T>, promise: Promise<P>): Promeister<P> {
  const internals = defaultInternals()
  internals.onEventList.push(() => {
    for (const resolvable of iterable) {
      if (resolvable instanceof Promeister) {
        resolvable.cancel()
      }
    }
  })
  return Promeister.From<P>(
    new Promise((resolve, reject) => {
      const callback = (): void => {
        reject(new CanceledError())
      }
      signal.addEventListener('abort', callback)
      promise
        .then(data => {
          signal.removeEventListener('abort', callback)
          resolve(data)
        })
        .catch(reject)
        .finally(() => {
          promiseAllFinalizer(internals)
        })
    }),
    internals
  )
}

/**
 *  Class extending the use of classic promises with lots of vital functionality.
 */
export default class Promeister<T, D = unknown> {
  /**
   *  Global `AbortController` used to handle all `Promeister` instances from static methods.
   */
  static GlobalController: AbortController = new AbortController()
  /**
   *  Global flag indicating whether to use the `GlobalController` also for normal `Promeister` created through constructor.
   */
  static UseGlobal = false
  #abortListener?: AnyFunction
  #att = 1
  #controller: AbortController
  readonly #internals: PromeisterInternals
  readonly #promise: Promise<T>
  #settled = false
  #signal: AbortSignal;
  [Symbol.toStringTag] = 'Promeister'

  constructor(executor: PromeisterCallback<T, D> = noop, opts?: PromeisterOptions<T>) {
    const options = Object.assign(
      { controller: Promeister.UseGlobal ? Promeister.GlobalController : new AbortController(), internals: defaultInternals() },
      opts
    )
    const internals = (this.#internals = options.internals)
    const controller = (this.#controller = options.controller)
    const signal = (this.#signal = controller.signal)

    this.#promise =
      options.promise ??
      new Promise<T>((resolve, reject) => {
        this.#settled = false

        const handleResolve = (value: T | PromiseLike<T>): void => {
          if (!this.#settled) {
            this.#settled = true
            this.cleanup(State.Resolved)
            resolve(value)
          }
        }

        const handleReject = (reason: any): void => {
          if (reason && typeof reason.then === 'function') {
            ;(reason as Promise<Error>).catch(handleReject)
          } else if (!this.#settled) this.onReject(reject, reason, State.Canceled)
        }

        this.#abortListener = (): void => {
          if (this.#settled || this.#internals.state.has(State.Interrupted)) return
          handleReject(new CanceledError())
        }

        signal.addEventListener('abort', this.#abortListener, AbortOptions)
        const exec = options.tries && options.tries > 1 ? this.createRetryExecutor(executor, options) : executor
        const delay = getDelay(options, 1)
        if (delay > 0) {
          sleep(delay)
            .then(() => {
              exec(handleResolve, handleReject, onCancel => {
                internals.onEventList.push(onCancel)
              })
            })
            .catch(handleReject)
        } else {
          exec(handleResolve, handleReject, onCancel => {
            internals.onEventList.push(onCancel)
          })
        }
      })

    // Add safety handler that works with fake timers
    this.#promise = this.#promise.catch((err: unknown) => {
      this.#settled = true
      this.cleanup(State.Rejected)
      throw err
    })

    if (options.timeout) this.#promise = Promise.race([this.#promise, this.createTimeout(options.timeout)]) as Promise<T>
  }

  private cleanup(states: number): void {
    if (states !== State.Resolved && states !== State.Timeout) this.#controller.abort()
    this.#internals.state.set(states)
    queueMicrotask(() => {
      this.#signal.removeEventListener('abort', this.#abortListener!)
      this.#internals.onEventList = []
    })
  }

  private createRetryExecutor(executor: PromeisterCallback<T, D>, options: PromeisterOptions<T>): PromeisterCallback<T, D> {
    return async (resolve, reject, onEvent) => {
      let attempt = 0

      const execute = async (): Promise<void> => {
        attempt++
        try {
          await new Promise<T>((innerResolve, innerReject) => {
            executor(innerResolve, innerReject, onEvent)
          }).then(value => {
            this.#att = attempt
            resolve(value)
          })
        } catch (err) {
          if (attempt >= options.tries!) {
            reject(err as Error)
            return
          }

          const delay = getDelay(options, attempt)

          if (delay > 0) {
            await new Promise(r => setTimeout(r, delay))
          }

          await execute()
        }
      }

      await execute()
    }
  }

  private async createTimeout(ms: number): Promise<never> {
    const signal = this.#signal
    return new Promise((_, reject) => {
      const timer = setTimeout(() => {
        this.event('timeout')
        this.onReject(reject, new TimeoutError(ms), State.Timeout)
      }, ms)
      const listener = (): void => {
        clearTimeout(timer)
        reject(new CanceledError())
        queueMicrotask(() => {
          signal.removeEventListener('abort', listener)
        })
      }
      signal.addEventListener('abort', listener, AbortOptions)
    })
  }

  private event(eventType: EventType, data?: D): void {
    if (this.#settled) return
    const event: PromeisterEvent<D> = { data, signal: this.#signal, type: eventType }
    const internals = this.#internals
    const handlers = internals.onEventList
    const len = handlers.length
    const controller = this.#controller
    const callbacks = new Array(len)
    for (let i = 0; i < len; i++) callbacks[i] = (): void => handlers[i](event)
    runCallbacks(callbacks)

    switch (eventType) {
      case 'cancel':
        this.cleanup(State.Canceled)
        break
      case 'interrupt':
        internals.state.set(State.Interrupted)
        controller.abort()
        internals.state.unset(State.Interrupted)
        queueMicrotask(() => {
          controller.signal.removeEventListener('abort', this.#abortListener!)
          this.#controller = new AbortController()
          this.#signal = this.#controller.signal
        })
        break
      case 'timeout':
        this.cleanup(State.Timeout)
        break
      default:
        throw new Error(`Unknown event ${eventType}.`)
    }
  }

  private onReject(reject: Rejector, reason: any, state: number): void {
    if (this.#settled) return
    this.#settled = true
    this.cleanup(state)
    reject(reason)
  }

  /**
   *  Fires a `cancel` even to abort the current `Promeister` instance.
   *
   *  @param data - data passed into the `onEvent` callback.
   */
  cancel(data?: D): void {
    this.event('cancel', data)
  }

  /**
   *  Attaches a callback for only the rejection of the `Promeister`.
   *
   *  @param onRejected — The callback to execute when the Promise is rejected.
   *  @returns A Promise for the completion of the callback.
   */
  catch<TResult>(onRejected?: OnRejected<TResult>): Promeister<T | TResult> {
    const internals = this.#internals
    return Promeister.From<T | TResult>(this.#promise.catch(createCallback(this.#internals, onRejected)), internals)
  }

  /**
   *  Attaches a callback that is invoked when the `Promeister` is settled (resolved or rejected). The resolved value cannot be modified from the callback.
   *
   *  @param onFinally — The callback to execute when the `Promeister` is settled (resolved or rejected).
   *  @param runOnEvent - Flag indicating whether the callback should be called on an event or not
   *  @returns A Promise for the completion of the callback.
   */
  finally(onFinally?: SimpleVoidFunction | null, runOnEvent?: boolean): Promeister<T> {
    const internals = this.#internals
    let callbacks = internals.onEventList
    if (runOnEvent && onFinally) callbacks.push(onFinally)

    return Promeister.From<T>(
      this.#promise.finally(
        createCallback(internals, () => {
          if (onFinally) {
            if (runOnEvent) callbacks = callbacks.filter(callback => callback !== onFinally)
            onFinally()
            this.cleanup(State.Resolved)
          }
        })
      ),
      internals
    )
  }

  /**
   *  Fires an `interrupt` even, changing the logic of the currently running `Promeister`.
   *
   *  @param data - data to pass as new state of the running promise.
   */
  interrupt(data?: D): void {
    this.event('interrupt', data)
  }

  /**
   *
   * @param onRe Attaches callbacks for the resolution and/or rejection of the `Promeister`.
   *
   *  @param onResolved — The callback to execute when the Promise is resolved.
   *  @param onRejected — The callback to execute when the Promise is rejected.
   *  @returns A Promise for the completion of which ever callback is executed.
   */
  then<TResult1 = T, TResult2 = never>(onResolved?: OnResolved<T, TResult1>, onRejected?: OnRejected<TResult2>): Promeister<TResult1 | TResult2> {
    const internals = this.#internals
    return Promeister.From<TResult1 | TResult2>(
      this.#promise.then(createCallback(internals, onResolved), createCallback(internals, onRejected)),
      internals
    )
  }

  /**
   *  Creates a `Promeister` that is resolved with an array of results when all of the provided Promises resolve, or rejected when any Promise is rejected.
   *
   *  @param values — An array of Promises.
   *  @returns — A new `Promeister`.
   */
  static all<T>(promises: Promise<T>[], controller: AbortController = Promeister.GlobalController): Promeister<Awaited<T>[]> {
    return makeAllCancelable(controller.signal, promises, Promise.all(promises))
  }

  /**
   *  Creates a `Promeister` that is resolved with an array of results when all of the provided Promises resolve or reject.
   *
   *  @param values — An array of Promises.
   *  @returns — A new `Promeister`.
   */
  static allSettled<T>(
    promises: Promise<T>[],
    controller: AbortController = Promeister.GlobalController
  ): Promeister<PromiseSettledResult<Awaited<T>>[]> {
    return makeAllCancelable(controller.signal, promises, Promise.allSettled(promises))
  }

  /**
   *  Creates a `Promeister` that is resolved by the first given promise to be resolved, or rejected with an AggregateError containing an
   *  array of rejection reasons if all of the given promises are rejected. It resolves all elements of the passed iterable to promises as it runs this algorithm.
   *
   *  @param values — An array or iterable of Promises.
   *  @returns — A new `Promeister`.
   */
  static any<T>(promises: Promise<T>[], controller: AbortController = Promeister.GlobalController): Promeister<Awaited<T>> {
    return makeAllCancelable(controller.signal, promises, Promise.any(promises))
  }

  /**
   *  Converts a promise to a `Promeister`.
   *
   *  @param promise - the promise to convert.
   *  @param internals - the internal memory of the `Promeister`.
   *  @param controller - the used `AbortController` to enable cancellation.
   *  @returns the created `Promeister`.
   */
  static From<T>(promise: Promise<T>, internals: PromeisterInternals = defaultInternals(), controller = Promeister.GlobalController): Promeister<T> {
    return new Promeister<T>(noop, { controller, internals, promise })
  }

  /**
   *  Creates a `Promeister` that is resolved or rejected when any of the provided Promises are resolved or rejected.
   *
   *  @param values — An array of Promises.
   *  @returns — A new Promise.
   */
  static race<T>(promises: Promise<T>[], controller: AbortController = Promeister.GlobalController): Promeister<Awaited<T>> {
    return makeAllCancelable(controller.signal, promises, Promise.race(promises))
  }

  /**
   *  Creates a new rejected `Promeister` for the provided reason.
   *
   *  @param reason — The reason the `Promeister` was rejected.
   *  @returns — A new rejected `Promeister`.
   */
  static reject(reason: Error, controller = Promeister.GlobalController): Promeister<never> {
    const internals = defaultInternals()
    const promise = Promise.reject(reason)
    promise.catch(() => {
      internals.state.set(State.Rejected)
      internals.onEventList = []
    })
    return Promeister.From(promise, internals, controller)
  }

  /**
   *  Creates a new resolved `Promeister` for the provided value.
   *
   *  @param value — Any value that should be returned.
   *  @returns — A `Promeister` whose internal state matches the provided promise.
   */
  static resolve<T>(value: T | PromiseLike<T>, controller = Promeister.GlobalController): Promeister<Awaited<T>> {
    return Promeister.From(Promise.resolve(value), defaultInternals(), controller)
  }

  /**
   *  Creates a `Promeister` with the purpose to delay a process.
   *
   *  @param ms - the amount of time to delay.
   *  @param opts - options used for normal `Promeister` creation without `timeout`.
   *  @returns the created `Promeister`.
   */
  static sleep(ms: number, opts: Partial<Omit<PromeisterOptions<void>, 'delay'>> = {}): Promeister<void> {
    ;(opts as PromeisterOptions<void>).delay = ms
    return new Promeister(noop, opts)
  }

  /**
   *  Flag indicating whether the `Promeister` has been aborted or not.
   */
  get aborted(): boolean {
    return this.#internals.state.has(State.Canceled | State.Rejected | State.Timeout)
  }

  /**
   *  Amount of attempts needed to resolve the promise.
   */
  get attempts(): number {
    return this.#att
  }

  /**
   *  Flag indicating whether the `Promeister` has been canceled or not.
   */
  get canceled(): boolean {
    return this.#internals.state.get(State.Canceled)
  }

  /**
   *  Flag indicating whether the `Promeister` has finished or not disregarding how it finished.
   */
  get done(): boolean {
    return this.#settled
  }

  /**
   *  Flag indicating whether the `Promeister` has timed out or not.
   */
  get timedOut(): boolean {
    return this.#internals.state.has(State.Timeout)
  }
}

function createCallback(internals: PromeisterInternals, onResult?: AnyFunction | null) {
  if (onResult) {
    return (arg?: unknown): any => {
      const result = onResult(arg)
      if (result instanceof Promeister) internals.onEventList.push(result.cancel)
      return result
    }
  }
}

function promiseAllFinalizer(internals: PromeisterInternals): void {
  if (!internals.state.has(State.Rejected)) return
  runCallbacks(internals.onEventList)
}
