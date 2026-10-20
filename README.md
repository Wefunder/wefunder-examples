# Wefunder examples

Runnable reference integrations for the [Wefunder API](https://docs.wefunder.com), built on the
official SDKs. Each directory is a complete application you can run, read, and copy from. The
snippet-level examples that feed the API reference live in the SDK repositories
([wefunder-node](https://github.com/Wefunder/wefunder-node),
[wefunder-python](https://github.com/Wefunder/wefunder-python),
[wefunder-ruby](https://github.com/Wefunder/wefunder-ruby)); this repository is for whole apps.

| Example | What it shows | Stack | Guide |
|---|---|---|---|
| [`investment-sync-nextjs`](./investment-sync-nextjs) | Install on the companies you serve, mirror their investments with the Investment Delta API, stay current with signed webhooks, post a money feed | Next.js 15, TypeScript, `@wefunder/sdk` | [Sync investments to your CRM](https://docs.wefunder.com/guides/sync-investments-to-crm) |
| [`raise-stats-widget`](./raise-stats-widget) | Show a company's live raise (amount, goal, investor count) on its own site from one static page, using a publishable key straight from the browser | HTML, no build, no SDK | [Show Your Raise on Your Own Site](https://docs.wefunder.com/guides/raise-stats-widget) |
| [`investment-session-expo`](./investment-session-expo) | Send an investor from an iOS or Android app through Wefunder's hosted checkout in a system browser sheet and handle the return; a small Node server mints the session so the install token never reaches the phone | Expo (React Native), TypeScript, Node, `@wefunder/sdk` | [Investment sessions on mobile](https://docs.wefunder.com/guides/investment-sessions-mobile) |

## Using an example

Copy one directory rather than the whole repository:

```bash
npx degit Wefunder/wefunder-examples/investment-sync-nextjs my-integration
cd my-integration && cp .env.example .env.local && npm install && npm run dev
```

Each example's README has its own setup, deploy notes, and a list of what it simplifies compared
to a production integration.

## Versions

Examples pin the SDK they were written against in their lockfile. CI runs every example's tests
on push and weekly, so an SDK release that breaks one shows up here first.

## License

MIT, see [LICENSE](./LICENSE).
