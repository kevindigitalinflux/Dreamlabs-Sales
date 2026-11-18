// Narrow local declaration for the edge shim and browser-project tests; the runtime uses the Node-compatible builtin.
declare module 'node:async_hooks' {
  export class AsyncLocalStorage<T> {
    getStore():T|undefined;
    run<R>(store:T,callback:()=>R):R;
  }
}
