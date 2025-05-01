# promeister

<p align="center">
<h1 align="center">The AIO Promise class</h1>
<p align="center">
  <a href="https://www.npmjs.com/package/promeister"><img src="https://img.shields.io/npm/v/promeister?style=for-the-badge&logo=npm"/></a>
  <a href="https://npmtrends.com/promeister"><img src="https://img.shields.io/npm/dm/promeister?style=for-the-badge"/></a>
  <a href="https://bundlephobia.com/package/promeister"><img src="https://img.shields.io/bundlephobia/minzip/promeister?style=for-the-badge"/></a>
  <a href="https://github.com/Torathion/promeister/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Torathion/promeister?style=for-the-badge"/></a>
  <a href="https://codecov.io/gh/torathion/promeister"><img src="https://codecov.io/gh/torathion/promeister/branch/main/graph/badge.svg?style=for-the-badge" /></a>
  <a href="https://github.com/torathion/promeister/actions"><img src="https://img.shields.io/github/actions/workflow/status/torathion/promeister/build.yml?style=for-the-badge&logo=esbuild"/></a>
<a href="https://github.com/prettier/prettier#readme"><img alt="code style" src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=for-the-badge&logo=prettier"></a>
</p>
</p>

`promeister` is a `Promise` class wrapper extending the core functionality with several vital features for complex promise constellations while still remaining simplicity in the implementation and can be used as a **drop-in replacement** for promises. It is written in the same style as a normal `Promise`, but with additional features such as:

- `AbortController` support
- Timeouts
- Retries
- Interrupts
- Delays

```powershell
    pnpm i promeister
```

As inspiration and base of this project served [`cancelable-promise`](https://www.npmjs.com/package/cancelable-promise). All tests of `cancelable-promise` work with `promeister` and the syntax is **mostly** the same. Notable differences are the removable of the functional programming styled `cancelable()` and changes in the options.

## Usage

### Basic

`promeister` has the exact same syntax as a normal `Promise` and you can write it the same way and it will work just like a normal promise:

```typescript
import Promeister from 'promeister'

const p = new Promeister((resolve, reject) => {
  // logic...
})
```

But `promeister` also comes with added functionality. The main extra is the `onCancel` / `onInterrupt` / `onEvent` function.

```typescript
import Promeister, { type EventType } from 'promeister'

async function func(mode: string): string {
  return Promise.resolve(mode)
}

let eventType: EventType
let logic: string

const p = new Promeister<number, string>((resolve, reject, onEvent), () => {

  onEvent((e) => {
    event = e.type // type of the triggered event.
    if (event === 'interrupt') {
      logic = func(e.data) // call internal promise with new logic
    } else if (event === 'cancel') {
      logic = e.data
    }
  })

  func.then(resolve)
})

p.interrupt('Mode 2')
// Wait some time and then cancel
p.cancel('canceled')

// Check state
p.done // True, as it has settled
p.aborted // True, as you've canceled it
p.timedOut // False, because no timeout
p.attempts // 1, no retries set.
```


### AbortController

You can define an external `AbortController` and cancel the Promeister through there:

```typescript
import Promeister from 'promeister'

const controller = new AbortController()

const p = await new Promeister(() => {}, { controller })

controller.abort()

p.done // True
p.aborted // True
```

You can define an external Controller for every static method as well.

```typescript
import Promeister from 'promeister'

await Promeister.all([p1, p2, p3], new AbortController())
```

But, if you have a very simple application that only needs a controller on a global level, you can define it as such:

```typescript
import Promeister from 'promeister'

Promeister.GlobalController = new AbortController()
// Use the global controller in the Promeister constructor. This can break things!
Promeister.UseGlobal = true

await Promeister.all([p1, p2, p3])
```

### Options

Just like in `cancelable-promise`, you can define extra options for your `promeister`:

#### internals (`PromeisterInternals`)

- holds a [`bitbob`](https://www.npmjs.com/package/bitbob) state map for fast and scalable state flags
- holds an array of `onEvent` callbacks that trigger on an event. Each `promeister` has their own callback and it even supports
  propagation.

#### promise (`Promise`)

- You can transform a normal `promise` into a `promeister`
- It won't have extra `AbortController`, retry or delay support.

#### controller (`AbortController`)

- You can define an external `AbortController`
- By default, it will always create a new one in the constructor and use the global one in the static methods.

#### timeout (`number`)

- Duration after which the promise should terminate.
- By default this functionality is deactivated and can be activated by passing a timeout

#### tries (`number`)

- Number of attempts to retry the promise.
- Just like `timeout` deactivated by default.

#### delay (`number | ((attempt: number) => number)`)

- Amount of time to wait before executing the promise.
- Can be decided for each attempt in combination with `tries` using a callback.
- Also like `tries` and `timeout` deactivated by default.

---

© Torathion 2025
