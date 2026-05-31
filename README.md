# Weeb-Screen

Internal-only anime episode tracker with first-class filler-skipping.

This repository is being implemented from `weeb-screen-spec.md`, one ticket-sized PR at a time.

## Ticket A Tooling

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:init
```

`pnpm db:init` creates `data/weebscreen.sqlite` unless `WEEBSCREEN_DB_PATH` is set or a path is passed as the first argument.

