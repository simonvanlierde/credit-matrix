// The two DOM names the CLI's modules mention, for the Node-only check (tsconfig.cli.json).
// xml-import.ts looks DOMParser up only when no parser is passed, and the CLI always passes linkedom's.
// Kept out of every DOM-typed program (the root tsconfig excludes this folder), where they would clash.
declare const DOMParser: new () => import("../export/xml-import").XmlParser;
type BufferSource = ArrayBufferView | ArrayBuffer;
