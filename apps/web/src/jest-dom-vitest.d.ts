import 'vitest'
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

// @testing-library/jest-dom 7 still augments vitest's old `Assertion<T>` shape,
// which no longer merges with the `Assertion<R, T>` vitest 5 declares, so every
// DOM matcher disappears from tsc (testing-library/jest-dom#738). Vitest 5's
// documented extension point is `Matchers<R, T>`, which jest-dom's own pending
// fix targets too — so augment that until a release lands. The type parameter
// list has to repeat vitest's declaration exactly, or TypeScript drops it.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Matchers<
    R extends void | Promise<void> = void | Promise<void>,
    _T = unknown,
  > extends TestingLibraryMatchers<unknown, R> {}
}
