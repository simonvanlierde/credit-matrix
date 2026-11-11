// biome-ignore-all lint/suspicious/noBitwiseOperators: font tables pack flags into bit fields.
import { FigureFontFileError, nodeModule } from "./figure-fonts";

// Finds a font family by name for figures, in Node: the `fontPath` folders first, then the system font
// folders. Only figures.ts loads this module, and only for a family other than sans or serif.

export interface FoundFont {
  /** The family's own name, from the font file. */
  family: string;
  file: string;
  /** A standalone face: one face of a collection is copied out into its own file. */
  bytes: Uint8Array;
  /** OS/2 fsType bit 0x0100: the face must be embedded whole. */
  noSubset: boolean;
  /** The face's own classification says serif: its fallback faces should be serif too. */
  serif: boolean;
  /** Set when the face's embedding permission restricts documents that embed it. */
  warning?: string;
}

export interface FontSearchOptions {
  fontPath?: string[];
  ignoreSystemFonts?: boolean;
}

interface Face {
  file: string;
  /** Face offset in a collection; 0 for a single font. */
  offset: number;
  families: string[];
  weight: number;
  width: number;
  upright: boolean;
  variable: boolean;
}

const FONT_FILE = /\.(?:ttf|otf|ttc|otc)$/i;
const WEB_FONT_FILE = /\.woff2?$/i;
const SFNT = new Set(["\x00\x01\x00\x00", "OTTO", "true"]);

const text = (bytes: Uint8Array) => String.fromCharCode(...bytes);

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Name ID 16 (typographic family) where the face has one, else name ID 1, in every language it lists. */
function familyNames(name: Uint8Array): string[] {
  const data = view(name);
  const count = data.getUint16(2);
  const strings = data.getUint16(4);
  const names = new Map<number, string[]>();
  for (let index = 0; index < count; index++) {
    const record = 6 + index * 12;
    if (record + 12 > name.length) break;
    const [platform, encoding, , id] = [0, 2, 4, 6].map((at) => data.getUint16(record + at));
    if (id !== 1 && id !== 16) continue;
    const start = strings + data.getUint16(record + 10);
    const raw = name.subarray(start, start + data.getUint16(record + 8));
    let value: string;
    if (platform === 0 || platform === 3) value = new TextDecoder("utf-16be").decode(raw);
    else if (platform === 1 && encoding === 0) value = text(raw);
    else continue;
    names.set(id ?? 1, [...(names.get(id ?? 1) ?? []), value]);
  }
  return names.get(16) ?? names.get(1) ?? [];
}

/** The tables a face's directory lists, by tag, as absolute file offsets and lengths. */
function directory(header: Uint8Array): Map<string, { offset: number; length: number }> {
  const data = view(header);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let index = 0; index < data.getUint16(4); index++) {
    const record = 12 + index * 16;
    if (record + 16 > header.length) break;
    tables.set(text(header.subarray(record, record + 4)), {
      offset: data.getUint32(record + 8),
      length: data.getUint32(record + 12),
    });
  }
  return tables;
}

function faceInfo(file: string, offset: number, tables: Map<string, Uint8Array>): Face | undefined {
  const name = tables.get("name");
  const os2 = tables.get("OS/2");
  if (!name || !os2 || os2.length < 64) return undefined;
  const data = view(os2);
  return {
    file,
    offset,
    families: familyNames(name),
    weight: data.getUint16(4),
    width: data.getUint16(6),
    // fsSelection bit 0 is italic, bit 9 oblique.
    upright: (data.getUint16(62) & 0x201) === 0,
    variable: tables.has("fvar"),
  };
}

type Handle = Awaited<ReturnType<typeof import("node:fs/promises").open>>;

async function readAt(handle: Handle, position: number, length: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

/** Each face in a TrueType or OpenType file or collection, from its table directory, name and OS/2 only. */
async function faces(file: string): Promise<Face[]> {
  const { open } = await nodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const handle = await open(file).catch(() => undefined);
  if (!handle) return [];
  try {
    const head = await readAt(handle, 0, 12);
    if (head.length < 12) return [];
    // A collection lists each face's offset after its 12-byte header.
    const collection = text(head.subarray(0, 4)) === "ttcf";
    const count = collection ? view(head).getUint32(8) : 0;
    const list = collection ? view(await readAt(handle, 12, count * 4)) : undefined;
    const starts = list ? Array.from({ length: list.byteLength / 4 }, (_, index) => list.getUint32(index * 4)) : [0];
    const found: Face[] = [];
    for (const start of starts) {
      const face = await readAt(handle, start, 12);
      if (face.length < 12 || !SFNT.has(text(face.subarray(0, 4)))) continue;
      const records = directory(await readAt(handle, start, 12 + view(face).getUint16(4) * 16));
      const tables = new Map<string, Uint8Array>();
      for (const tag of ["name", "OS/2", "fvar"]) {
        const record = records.get(tag);
        // fvar only needs to exist here.
        if (record)
          tables.set(tag, tag === "fvar" ? new Uint8Array() : await readAt(handle, record.offset, record.length));
      }
      const described = faceInfo(file, start, tables);
      if (described) found.push(described);
    }
    return found;
  } catch {
    // A damaged file in a font folder is skipped, as fontconfig skips it.
    return [];
  } finally {
    await handle.close();
  }
}

// WOFF2's known-table index: name is entry 5.
const WOFF2_NAME = 5;

function base128(data: DataView, at: { offset: number }): number {
  let value = 0;
  for (let index = 0; index < 5; index++) {
    const byte = data.getUint8(at.offset++);
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return value;
  }
  return value;
}

/** A WOFF or WOFF2 file's family names, so a search can say the family is installed only as a web font. */
async function webFontFamilies(file: string): Promise<string[]> {
  const { readFile } = await nodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const { brotliDecompressSync, inflateSync } = await nodeModule<typeof import("node:zlib")>("node:zlib");
  try {
    const bytes = new Uint8Array(await readFile(file));
    const data = view(bytes);
    const signature = text(bytes.subarray(0, 4));
    if (signature === "wOFF") {
      for (let index = 0; index < data.getUint16(12); index++) {
        const record = 44 + index * 20;
        if (text(bytes.subarray(record, record + 4)) !== "name") continue;
        const offset = data.getUint32(record + 4);
        const table = bytes.subarray(offset, offset + data.getUint32(record + 8));
        return familyNames(table.length < data.getUint32(record + 12) ? new Uint8Array(inflateSync(table)) : table);
      }
    }
    if (signature === "wOF2") {
      // Tables follow each other unpadded in one Brotli stream, in directory order, after the directory.
      const at = { offset: 48 };
      let start = 0;
      let name: { start: number; length: number } | undefined;
      for (let index = 0; index < data.getUint16(12); index++) {
        const flags = data.getUint8(at.offset++);
        const known = flags & 0x3f;
        if (known === 63) at.offset += 4;
        const length = base128(data, at);
        // glyf and loca are transformed at version 0, every other table at any other version.
        const transformed = known === 10 || known === 11 ? flags >> 6 === 0 : flags >> 6 !== 0;
        const stored = transformed ? base128(data, at) : length;
        if (known === WOFF2_NAME) name = { start, length };
        start += stored;
      }
      if (name && text(bytes.subarray(4, 8)) !== "ttcf") {
        const stream = brotliDecompressSync(bytes.subarray(at.offset, at.offset + data.getUint32(20)));
        return familyNames(new Uint8Array(stream).subarray(name.start, name.start + name.length));
      }
    }
  } catch {
    // An unreadable web font only loses the hint.
  }
  return [];
}

async function fontFiles(folder: string, pattern: RegExp): Promise<string[]> {
  const { readdir, realpath, stat } = await nodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const { join } = await nodeModule<typeof import("node:path")>("node:path");
  const files: string[] = [];
  // Folder by folder, so one unreadable subfolder hides only itself; real paths stop symlink loops.
  const seen = new Set<string>();
  const pending = [folder];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const real = await realpath(next).catch(() => undefined);
    if (!real || seen.has(real)) continue;
    seen.add(real);
    const entries = await readdir(next, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(next, entry.name);
      const isFolder =
        entry.isDirectory() || (entry.isSymbolicLink() && (await stat(path).catch(() => undefined))?.isDirectory());
      if (isFolder) pending.push(path);
      else if (pattern.test(entry.name)) files.push(path);
    }
  }
  return files.sort();
}

/** The folders fontconfig, macOS and Windows install fonts in, for this platform. */
async function systemFolders(): Promise<string[]> {
  const process = (globalThis as { process?: NodeJS.Process }).process;
  const { homedir } = await nodeModule<typeof import("node:os")>("node:os");
  const { join } = await nodeModule<typeof import("node:path")>("node:path");
  const env = process?.env ?? {};
  const home = homedir();
  if (process?.platform === "win32")
    return [
      join(env.WINDIR ?? "C:\\Windows", "Fonts"),
      join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "Microsoft", "Windows", "Fonts"),
    ];
  if (process?.platform === "darwin")
    return ["/System/Library/Fonts", "/Library/Fonts", join(home, "Library", "Fonts")];
  const data = [
    env.XDG_DATA_HOME || join(home, ".local", "share"),
    ...(env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":"),
  ];
  return [
    ...new Set([
      ...data.filter(Boolean).map((folder) => join(folder, "fonts")),
      "/usr/share/fonts",
      "/usr/local/share/fonts",
      join(home, ".local", "share", "fonts"),
      join(home, ".fonts"),
    ]),
  ];
}

/**
 * CSS Fonts 4 matching for weight 400: 400, then 500, then lighter weights descending, then bolder ones
 * ascending. Then the width nearest normal, and a static face before a variable one.
 */
function rank(face: Face): number[] {
  const weight =
    face.weight === 400 ? 0 : face.weight === 500 ? 1 : face.weight < 400 ? 2 + 400 - face.weight : 2000 + face.weight;
  return [face.upright ? 0 : 1, weight, Math.abs(face.width - 5), face.variable ? 1 : 0];
}

function compare(a: Face, b: Face): number {
  const [left, right] = [rank(a), rank(b)];
  for (const [index, value] of left.entries()) if (value !== right[index]) return value - (right[index] ?? 0);
  return 0;
}

function checksum(bytes: Uint8Array): number {
  const data = view(bytes);
  let sum = 0;
  for (let offset = 0; offset + 4 <= bytes.length; offset += 4) sum = (sum + data.getUint32(offset)) % 2 ** 32;
  return sum;
}

/** One face of a collection as a standalone font file. Collection table offsets are absolute in the file. */
function standalone(file: Uint8Array, offset: number): Uint8Array {
  const tables = [...directory(file.subarray(offset))].sort(([a], [b]) => (a < b ? -1 : 1));
  const header = 12 + tables.length * 16;
  const padded = tables.reduce((sum, [, { length }]) => sum + Math.ceil(length / 4) * 4, 0);
  const bytes = new Uint8Array(header + padded);
  const data = view(bytes);
  bytes.set(file.subarray(offset, offset + 12));
  let at = header;
  let head = -1;
  for (const [index, [tag, { offset: from, length }]] of tables.entries()) {
    const record = 12 + index * 16;
    bytes.set(file.subarray(from, from + length), at);
    for (let char = 0; char < 4; char++) bytes[record + char] = tag.charCodeAt(char);
    if (tag === "head") {
      head = at;
      data.setUint32(at + 8, 0);
    }
    data.setUint32(record + 4, checksum(bytes.subarray(at, at + Math.ceil(length / 4) * 4)));
    data.setUint32(record + 8, at);
    data.setUint32(record + 12, length);
    at += Math.ceil(length / 4) * 4;
  }
  if (head >= 0) data.setUint32(head + 8, (0xb1b0afba - checksum(bytes) + 2 ** 32) % 2 ** 32);
  return bytes;
}

/** The default instance's position on each axis of a variable face's fvar table. */
function axisDefaults(fvar: Uint8Array): Map<string, number> {
  const data = view(fvar);
  const defaults = new Map<string, number>();
  const axes = data.getUint16(4);
  for (let index = 0; index < data.getUint16(8); index++) {
    const record = axes + index * data.getUint16(10);
    defaults.set(text(fvar.subarray(record, record + 4)), data.getInt32(record + 8) / 65536);
  }
  return defaults;
}

/**
 * Whether the face classes itself as serif: the OS/2 sFamilyClass class (1-5 and 7 serif, 8 sans), else
 * PANOSE Latin Text (family type 2) with a serif style of 2-10 (11-13 are sans). Unclassified faces are sans.
 */
function isSerif(os2: DataView): boolean {
  const family = os2.getUint8(30);
  if ((family >= 1 && family <= 5) || family === 7) return true;
  if (family === 8) return false;
  const style = os2.getUint8(33);
  return os2.getUint8(32) === 2 && style >= 2 && style <= 10;
}

/** Why the face's OS/2 fsType restricts embedding it, if it does. */
function restriction(fsType: number): string | undefined {
  const usage = fsType & 0xf;
  // OS/2 versions 0-2 can set several usage bits; the least restrictive one applies.
  if (fsType & 0x200) return "bitmap embedding only";
  if (usage & 8 || !usage) return undefined;
  if (usage & 4) return "preview and print embedding";
  if (usage & 2) return "restricted license embedding";
  return undefined;
}

/** Find `family` (case-insensitive) and read its upright regular face. */
export async function findFigureFont(family: string, options: FontSearchOptions = {}): Promise<FoundFont> {
  if (!(globalThis as { process?: NodeJS.Process }).process?.versions?.node)
    throw new FigureFontFileError(`A figure font family (${family}) can only be used in Node; use sans or serif.`);
  const wanted = family.trim().toLowerCase();
  if (!wanted) throw new FigureFontFileError("The figure font family name is empty.");
  const { resolve } = await nodeModule<typeof import("node:path")>("node:path");
  const groups = [(options.fontPath ?? []).map((folder) => resolve(folder))];
  if (!options.ignoreSystemFonts) groups.push(await systemFolders());
  let best: Face | undefined;
  for (const folders of groups) {
    for (const folder of folders)
      for (const file of await fontFiles(folder, FONT_FILE))
        for (const face of await faces(file))
          if (face.families.some((name) => name.toLowerCase() === wanted) && (!best || compare(face, best) < 0))
            best = face;
    // A family in a fontPath folder wins over the same family installed on the system.
    if (best) break;
  }
  const searched = `${options.fontPath?.length ? `the font path (${options.fontPath.join(", ")})` : "no font path"}${options.ignoreSystemFonts ? ", with system fonts ignored" : " or the system fonts"}`;
  if (!best) {
    for (const folders of groups)
      for (const folder of folders)
        for (const file of await fontFiles(folder, WEB_FONT_FILE))
          if ((await webFontFamilies(file)).some((name) => name.toLowerCase() === wanted))
            throw new FigureFontFileError(
              `${file} is a web font (WOFF), which figures cannot embed. Install the .ttf or .otf build of ${family}.`,
            );
    throw new FigureFontFileError(`Cannot find the font family ${family} in ${searched}.`);
  }
  const { readFile } = await nodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const file = new Uint8Array(await readFile(best.file));
  const bytes = text(file.subarray(0, 4)) === "ttcf" ? standalone(file, best.offset) : file;
  const tables = directory(bytes);
  const table = (tag: string) => {
    const record = tables.get(tag);
    return record ? bytes.subarray(record.offset, record.offset + record.length) : new Uint8Array(64);
  };
  const ownName = familyNames(table("name")).find((candidate) => candidate.toLowerCase() === wanted) ?? family;
  if (best.variable) {
    const defaults = axisDefaults(table("fvar"));
    const weight = defaults.get("wght") ?? 400;
    if (weight !== 400 || (defaults.get("ital") ?? 0) !== 0 || (defaults.get("slnt") ?? 0) !== 0)
      throw new FigureFontFileError(
        `${best.file} is a variable font whose default instance is ${weight === 400 ? "not upright" : `weight ${weight}, not 400`}. Install the static Regular build of ${ownName} (a .ttf or .otf file).`,
      );
  }
  const os2 = view(table("OS/2"));
  const fsType = os2.getUint16(8);
  const restricted = restriction(fsType);
  return {
    family: ownName,
    file: best.file,
    bytes,
    noSubset: (fsType & 0x100) !== 0,
    serif: isSerif(os2),
    warning: restricted
      ? `${best.file} allows only ${restricted} (OS/2 fsType 0x${fsType.toString(16).padStart(4, "0")}). It is embedded anyway: check that the font's license lets you share the figure.`
      : undefined,
  };
}
