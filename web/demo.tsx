import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { run } from "../src/index";

const DEFAULT_SOURCE = `x, y := xor.
? x.`;

function Demo() {
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const output = useMemo(() => run(source).log.join("\n\n"), [source]);

  return (
    <>
      <h1>Syrup playground</h1>
      <p>Run Syrup source code in the browser using the ESM build.</p>
      <textarea value={source} onChange={(event) => setSource(event.currentTarget.value)} />
      <pre>{output}</pre>
    </>
  );
}

const rootEl = document.getElementById("app");
if (!rootEl) {
  throw new Error("Missing #app root");
}

createRoot(rootEl).render(<Demo />);
