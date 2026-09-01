# server/plugins

This is the **live** plugin directory for `npm run dev:server`.

Drop trusted `.ts` / `.js` / `.mjs` modules that export `plugin` or `default`.

- Missing directory is fine — the server still starts.
- `_` prefixed files, README, and `.gitkeep` are skipped.
- `/hello` is **not** a built-in command. Stock `server/plugins/` is empty on purpose.

## Local QA for `/hello`

```bash
cp server/plugin-examples/hello.ts server/plugins/hello.ts
# restart npm run dev:server
```

Or without copying:

```bash
FC_EXAMPLE_PLUGIN=1 npm run dev:server
```

See `docs/PLUGINS.md`. Installing a plugin gives it server authority. This is not a sandbox.
