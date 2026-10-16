# Browser check

Quick checks of the built app in headless Chrome, used until the Playwright suite exists.

```sh
(cd app && npm run build)
tools/browser-check/start.sh
node tools/browser-check/cdp.mjs shot 9333 /tmp/ui.png 1280 800
node tools/browser-check/cdp.mjs eval 9333 "document.querySelector('.status-bar').innerText"
tools/browser-check/stop.sh
```

The `shot` command can run a script before the screenshot, e.g. to open a menu:

```sh
node tools/browser-check/cdp.mjs shot 9333 /tmp/menu.png 1100 420 \
  "[...document.querySelectorAll('.menu__button')].find(b => b.textContent === 'Tools').click()" 500
```

Note: `--dump-dom` and `--virtual-time-budget` do not wait for the compute worker; use these
scripts, which wait in real time. To set an input value from a script, use the native setter so
React sees the change:
`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '42')`,
then dispatch an `input` event and blur the field.
