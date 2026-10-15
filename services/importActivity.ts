// Suppress redundant HTTP refreshes while this tab is importing accounts.
let activeImports = 0;
export const isImportActive = () => activeImports > 0;
export function beginImport() {
  activeImports += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    activeImports -= 1;
    if (!activeImports) window.dispatchEvent(new Event("ivs-import-finished"));
  };
}
