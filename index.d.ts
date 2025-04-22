import type { AnyFunction, OnResolved, OnRejected, Rejector, Resolver, SimpleVoidFunction } from 'typestar'
import type { Bitmap } from 'bitbob'

declare module 'promeister' {
  /**
   *  Error indicating that the `Promeister` has been canceled.
   */
  export class CanceledError extends Error {
    constructor()
  }
  /**
   *  Error indicating the `Promeister` has been timed out.
   */
  export class TimeoutError extends Error {
    constructor(ms: number)
  }
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
  /**
   *  Generates the default internals for the Promeister memory.
   *
   *  @returns the default `PromeisterInternals`.
   */
  export function defaultInternals(): PromeisterInternals
  /**
   *  Class extending the use of classic promises with lots of vital functionality.
   */
  export default class Promeister<T, D = unknown> {
    /**
     *  Global `AbortController` used to handle all `Promeister` instances from static methods.
     */
    static GlobalController: AbortController
    /**
     *  Global flag indicating whether to use the `GlobalController` also for normal `Promeister` created through constructor.
     */
    static UseGlobal
    constructor(executor?: PromeisterCallback<T, D>, opts?: PromeisterOptions<T>)
    /**
     *  Fires a `cancel` even to abort the current `Promeister` instance.
     *
     *  @param data - data passed into the `onEvent` callback.
     */
    cancel(data?: D): void
    /**
     *  Attaches a callback for only the rejection of the `Promeister`.
     *
     *  @param onRejected — The callback to execute when the Promise is rejected.
     *  @returns A Promise for the completion of the callback.
     */
    catch<TResult>(onRejected?: OnRejected<TResult>): Promeister<T | TResult>
    /**
     *  Attaches a callback that is invoked when the `Promeister` is settled (resolved or rejected). The resolved value cannot be modified from the callback.
     *
     *  @param onFinally — The callback to execute when the `Promeister` is settled (resolved or rejected).
     *  @param runOnEvent - Flag indicating whether the callback should be called on an event or not
     *  @returns A Promise for the completion of the callback.
     */
    finally(onFinally?: SimpleVoidFunction | null, runOnEvent?: boolean): Promeister<T>
    /**
     *  Fires an `interrupt` even, changing the logic of the currently running `Promeister`.
     *
     *  @param data - data to pass as new state of the running promise.
     */
    interrupt(data?: D): void
    /**
     *
     * @param onRe Attaches callbacks for the resolution and/or rejection of the `Promeister`.
     *
     *  @param onResolved — The callback to execute when the Promise is resolved.
     *  @param onRejected — The callback to execute when the Promise is rejected.
     *  @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onResolved?: OnResolved<T, TResult1>, onRejected?: OnRejected<TResult2>): Promeister<TResult1 | TResult2>
    /**
     *  Creates a `Promeister` that is resolved with an array of results when all of the provided Promises resolve, or rejected when any Promise is rejected.
     *
     *  @param values — An array of Promises.
     *  @returns — A new `Promeister`.
     */
    static all<T>(promises: Promise<T>[], controller?: AbortController): Promeister<Awaited<T>[]>
    /**
     *  Creates a `Promeister` that is resolved with an array of results when all of the provided Promises resolve or reject.
     *
     *  @param values — An array of Promises.
     *  @returns — A new `Promeister`.
     */
    static allSettled<T>(promises: Promise<T>[], controller?: AbortController): Promeister<PromiseSettledResult<Awaited<T>>[]>
    /**
     *  Creates a `Promeister` that is resolved by the first given promise to be resolved, or rejected with an AggregateError containing an
     *  array of rejection reasons if all of the given promises are rejected. It resolves all elements of the passed iterable to promises as it runs this algorithm.
     *
     *  @param values — An array or iterable of Promises.
     *  @returns — A new `Promeister`.
     */
    static any<T>(promises: Promise<T>[], controller?: AbortController): Promeister<Awaited<T>>
    /**
     *  Converts a promise to a `Promeister`.
     *
     *  @param promise - the promise to convert.
     *  @param internals - the internal memory of the `Promeister`.
     *  @param controller - the used `AbortController` to enable cancellation.
     *  @returns the created `Promeister`.
     */
    static From<T>(promise: Promise<T>, internals?: PromeisterInternals, controller?: AbortController): Promeister<T>
    /**
     *  Creates a `Promeister` that is resolved or rejected when any of the provided Promises are resolved or rejected.
     *
     *  @param values — An array of Promises.
     *  @returns — A new Promise.
     */
    static race<T>(promises: Promise<T>[], controller?: AbortController): Promeister<Awaited<T>>
    /**
     *  Creates a new rejected `Promeister` for the provided reason.
     *
     *  @param reason — The reason the `Promeister` was rejected.
     *  @returns — A new rejected `Promeister`.
     */
    static reject(reason: Error, controller?: AbortController): Promeister<never>
    /**
    *  Creates a new resolved `Promeister` for the provided value.
    *
    *  @param value — Any value that should be returned.
    *  @returns — A `Promeister` whose internal state matches the provided promise.
    */
    static resolve<T>(value: T | PromiseLike<T>, controller?: AbortController): Promeister<Awaited<T>>
    /**
     *  Creates a `Promeister` with the purpose to delay a process.
     *
     *  @param ms - the amount of time to delay.
     *  @param opts - options used for normal `Promeister` creation without `timeout`.
     *  @returns the created `Promeister`.
     */
    static sleep(ms: number, opts: Partial<Omit<PromeisterOptions<void>, 'delay'>>): Promeister<void>
    /**
     *  Flag indicating whether the `Promeister` has been aborted or not.
     */
    get aborted(): boolean
    /**
     *  Amount of attempts needed to resolve the promise.
     */
    get attempts(): number
    /**
     *  Flag indicating whether the `Promeister` has been canceled or not.
     */
    get canceled(): boolean
    /**
     *  Flag indicating whether the `Promeister` has finished or not disregarding how it finished.
     */
    get done(): boolean
    /**
     *  Flag indicating whether the `Promeister` has timed out or not.
     */
    get timedOut(): boolean
  }
}
