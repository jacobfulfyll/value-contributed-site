import "./Arrow.es2015.min.js";

if (!globalThis.Arrow?.tableFromIPC) {
  throw new Error("The vendored Apache Arrow decoder did not initialize.");
}

export const tableFromIPC = globalThis.Arrow.tableFromIPC;
