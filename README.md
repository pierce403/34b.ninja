# 34b.ninja

An unofficial, private-by-design browser utility for the DEF CON 34 Baochip badge.

The site uses the Web Serial API to:

- ask the user to select the badge's USB serial port;
- display the USB vendor and product identifiers exposed to the browser; and
- send the official read-only `ver xous` console command and display the response.

Everything runs locally in the browser. The site has no backend, analytics, or storage.

## Browser support

Web Serial requires a secure context and a supporting Chromium-based desktop browser such as Chrome or Edge. Device access is always initiated by a user gesture and confirmed in the browser's port picker.

## Develop

```sh
npm run dev
```

Open `http://127.0.0.1:4173/`. Localhost is treated as a secure context for Web Serial development.

## Test

```sh
npm test
```

## Badge references

- [Official DEF CON 34 badge help](https://media.defcon.org/DEF%20CON%2034/DEF%20CON%2034%20badge/badge-index.html)
- [DC34 console source](https://github.com/bunnie/dc34-console)
- [Official image uploader](https://github.com/bunnie/dc34-image)
- [Baochip-1x source](https://github.com/baochip/baochip-1x)

## License

MIT. This is an unofficial community project and is not affiliated with DEF CON or Baochip.
