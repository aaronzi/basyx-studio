# Project Rules

## General
- Follow the existing code style and patterns.
- Use pnpm for running project commands.
- Keep code in TypeScript unless migration is required.

## Stack
- Framework: Nuxt 4
- UI Library: Vuetify
- Enabled Features: ESLint, Vuetify MCP, Pinia, Vue I18n, Client Hints

## Tooling
- The Vuetify MCP server is configured in `.mcp.json` and runs the version
  pinned in `pnpm-lock.yaml` (`@vuetify/mcp`). Use it to look up Vuetify 4
  component APIs, props, slots, and breaking changes instead of guessing.
  Tools that create bins, links, or playgrounds publish content to Vuetify's
  services; do not use them with project code.
- The official Nuxt MCP server (`https://nuxt.com/mcp`, read-only docs) is
  configured in `.mcp.json`. Use it for Nuxt 4 and Nitro questions such as
  server assets, route rules, runtime config, and module APIs.
