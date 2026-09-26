# @deerdaily/bot-api

Run the official native Telegram Bot API server with Deno 2.9.6+ or Node 22+.
The first public package release is pending; these commands become available
after publication.

```sh
deno run -N -R -W --allow-run --allow-env jsr:@deerdaily/bot-api --api-id ... --api-hash ... --local
npx @deerdaily/bot-api --help
```

The CLI passes every argument unchanged to the server. Consult the
[upstream documentation](https://github.com/tdlib/telegram-bot-api#usage) for
flags. The native process runs outside Deno's permission sandbox.

For programmatic use, import `startBotApiServer` from
`jsr:@deerdaily/bot-api/api` (Deno) or `@deerdaily/bot-api/api` (Node). Set
`TELEGRAM_BOT_API_BINARY` to use an existing server executable.

See the [repository README](https://github.com/KnightNiwrem/prebuilt-tg-bot-api)
for supported platforms, compilation, permissions, and deployment guidance.
