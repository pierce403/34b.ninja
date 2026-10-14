import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Workers Builds is an unprivileged Ubuntu 24.04 container. Extract its signed
// distribution packages into this checkout; never install into the host OS.
if (process.platform !== 'linux' || process.arch !== 'x64' ||
    !readFileSync('/etc/os-release', 'utf8').includes('VERSION_ID="24.04"')) {
  throw new Error('This prerequisite targets Cloudflare Ubuntu 24.04 x64 only; use npm run check locally.');
}
const root = resolve('.cloudflare-check');
const downloads = resolve(root, 'packages');
const libraries = resolve(root, 'root');
const lists = resolve(root, 'lists');
for (const directory of [downloads, libraries, resolve(lists, 'partial')]) mkdirSync(directory, { recursive: true });
const aptOptions = ['-o', `Dir::State::lists=${lists}`];
execFileSync('apt-get', [...aptOptions, 'update'], { stdio: 'inherit' });
// Chromium dependencies from pinned Playwright 1.62.1's ubuntu24.04-x64 map,
// plus their shared-library dependencies absent from minimal build images.
const packages = [
  'libasound2t64', 'libatk-bridge2.0-0t64', 'libatk1.0-0t64', 'libatspi2.0-0t64',
  'libcairo2', 'libcups2t64', 'libdbus-1-3', 'libdrm2', 'libgbm1',
  'libglib2.0-0t64', 'libnspr4', 'libnss3', 'libpango-1.0-0', 'libx11-6',
  'libxcb1', 'libxcomposite1', 'libxdamage1', 'libxext6', 'libxfixes3',
  'libxkbcommon0', 'libxrandr2', 'libavahi-client3', 'libavahi-common3',
  'libfontconfig1', 'libfreetype6', 'libharfbuzz0b', 'libthai0', 'libdatrie1',
  'libpixman-1-0', 'libxcb-render0', 'libxcb-shm0', 'libxrender1',
  'libpng16-16t64', 'libbrotli1', 'libexpat1', 'libgraphite2-3', 'libxau6', 'libxdmcp6',
  'libxi6', 'libxcursor1', 'libxtst6', 'libxss1', 'libxinerama1', 'libxshmfence1',
];
execFileSync('apt-get', [...aptOptions, 'download', ...packages], { cwd: downloads, stdio: 'inherit' });
for (const file of readdirSync(downloads).filter(name => name.endsWith('.deb'))) {
  execFileSync('dpkg-deb', ['--extract', resolve(downloads, file), libraries], { stdio: 'inherit' });
}
const environment = { ...process.env, LD_LIBRARY_PATH: [
  resolve(libraries, 'usr/lib/x86_64-linux-gnu'),
  resolve(libraries, 'lib/x86_64-linux-gnu'), process.env.LD_LIBRARY_PATH,
].filter(Boolean).join(':') };
execFileSync(resolve('node_modules/.bin/playwright'), ['install', 'chromium'], { env: environment, stdio: 'inherit' });
execFileSync('npm', ['run', 'check'], { env: environment, stdio: 'inherit' });
