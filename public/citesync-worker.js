const runtimeURL = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";

self.onmessage = async ({ data }) => {
  try {
    const [{ loadPyodide }, manifest] = await Promise.all([
      import(`${runtimeURL}pyodide.mjs`),
      fetch("/citesync/runtime.json").then((response) => {
        if (!response.ok) throw new Error("The converter build is missing.");
        return response.json();
      }),
    ]);
    if (manifest.version !== "0.4.0") throw new Error("The converter version changed. Reload the page.");
    const [python, wheels] = await Promise.all([
      loadPyodide({ indexURL: runtimeURL }),
      Promise.all(
        manifest.wheels.map(async ({ name, sha256 }) => {
          if (!/^[\w.-]+\.whl$/.test(name)) throw new Error("Invalid converter package.");
          const response = await fetch(`/citesync/${name}`);
          if (!response.ok) throw new Error("A converter package is missing.");
          const bytes = new Uint8Array(await response.arrayBuffer());
          const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
          if (hash !== sha256) throw new Error("The converter package checksum changed.");
          return { name, bytes };
        }),
      ),
    ]);
    for (const { name, bytes } of wheels) python.FS.writeFile(`/tmp/${name}`, bytes);
    python.globals.set("wheel_names_json", JSON.stringify(wheels.map(({ name }) => name)));
    python.globals.set("request_json", JSON.stringify(data));
    const result = await python.runPythonAsync(`
import json, zipfile, sys
from pathlib import Path
site = Path('/tmp/citesync-packages')
site.mkdir(exist_ok=True)
for name in json.loads(wheel_names_json):
    with zipfile.ZipFile('/tmp/' + name) as wheel:
        wheel.extractall(site)
sys.path.insert(0, str(site))
from citesync.playground import generate
json.dumps(generate(json.loads(request_json)))
`);
    self.postMessage({ codemeta: JSON.parse(result).files["codemeta.json"] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Conversion failed." });
  }
};
