# Plugin examples

These modules are **not** loaded by `npm run dev:server`.

Default discovery is `server/plugins/` only. This folder is a copy source for local QA.

```bash
cp server/plugin-examples/hello.ts server/plugins/hello.ts
# restart the Anarchy server
```

Or start with the bundled example without copying:

```bash
FC_EXAMPLE_PLUGIN=1 npm run dev:server
```

Do not put broken/invalid test fixtures here.
