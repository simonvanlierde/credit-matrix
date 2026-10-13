import { DOMParser } from "linkedom";

// What a Node user passes as `{ parser }`, installed as the global the XML import defaults to.
globalThis.DOMParser ??= DOMParser as unknown as typeof globalThis.DOMParser;
