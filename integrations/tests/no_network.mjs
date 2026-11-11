// Preloaded into every Node child (NODE_OPTIONS=--import) so a CLI run cannot download figure fonts.
globalThis.fetch = () => Promise.reject(new TypeError("blocked by integrations/tests/no_network.mjs"));
