# Bible Plugin Install Commands

If OpenClaw reports stale `bible-plugin` config entries or `plugin not found`, first remove the `bible-plugin` entries from:

```text
~/.openclaw/openclaw.json
```

Then run:

```bash
cd /home/kirt/projects/openclaw/extensions/extensions/bible-plugin
npm install
npm run build
```

Install the plugin from the project source:

```bash
~/.nvm/versions/node/v24.14.1/bin/openclaw plugins install --force /home/kirt/projects/openclaw/extensions/extensions/bible-plugin
```

Refresh the registry and restart the gateway:

```bash
~/.nvm/versions/node/v24.14.1/bin/openclaw plugins registry --refresh
systemctl --user restart openclaw-gateway.service
```

Optional verification:

```bash
~/.nvm/versions/node/v24.14.1/bin/openclaw config validate
~/.nvm/versions/node/v24.14.1/bin/openclaw plugins inspect bible-plugin --json
```

Success check:

- `commands` includes `"bible"`
