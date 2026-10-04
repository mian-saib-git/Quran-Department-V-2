Files stored in _update_backups are historical copies, not active project source.
TypeScript and JavaScript backup files have '.backup' appended so VS Code cannot load them as live source files.
Their contents are unchanged. Remove only the final '.backup' suffix when manually restoring a file.
