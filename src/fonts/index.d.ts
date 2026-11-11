export type FigureFace = "sans" | "sans-jp" | "sans-sc" | "serif" | "serif-jp" | "serif-sc";

/** Read one face's bytes: from disk in Node, over HTTP from a bundle's assets in a browser. */
export function fonts(face: FigureFace): Promise<Uint8Array>;
