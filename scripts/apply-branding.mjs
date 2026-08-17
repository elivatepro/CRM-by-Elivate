import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const frontRoot =
  process.env.TWENTY_FRONT_ROOT ??
  '/app/packages/twenty-server/dist/front';
const serverDistRoot =
  process.env.TWENTY_SERVER_DIST_ROOT ??
  '/app/packages/twenty-server/dist';

const productName = 'Elivate Network';
const productDescription =
  'Elivate Network customer relationship workspace.';

const replaceAllWithCount = (content, from, to) => {
  const count = content.split(from).length - 1;

  return {
    content: count === 0 ? content : content.split(from).join(to),
    count,
  };
};

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walk(entryPath)));
    } else {
      files.push(entryPath);
    }
  }

  return files;
};

const patchIndex = async () => {
  const indexPath = path.join(frontRoot, 'index.html');
  let index = await readFile(indexPath, 'utf8');

  const replacements = [
    ['<title>Twenty</title>', `<title>${productName}</title>`],
    ['<title>CRM by Elivate</title>', `<title>${productName}</title>`],
    ['content="Twenty"', `content="${productName}"`],
    ['content="CRM by Elivate"', `content="${productName}"`],
    [
      'content="A modern open-source CRM"',
      `content="${productDescription}"`,
    ],
  ];

  for (const [from, to] of replacements) {
    const result = replaceAllWithCount(index, from, to);

    if (result.count === 0 && !index.includes(to)) {
      throw new Error(`Expected index metadata was not found: ${from}`);
    }

    index = result.content;
  }

  const socialImagePattern =
    /\s*<meta\s+(?:property="og:image"|name="twitter:image")[\s\S]*?\/>/g;
  const socialImageMatches = index.match(socialImagePattern) ?? [];

  if (![0, 2].includes(socialImageMatches.length)) {
    throw new Error(
      `Expected two Twenty social image tags, found ${socialImageMatches.length}.`,
    );
  }

  index = index.replace(socialImagePattern, '');

  await writeFile(indexPath, index);
};

const patchManifest = async () => {
  const manifestPath = path.join(frontRoot, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  manifest.short_name = 'Elivate Network';
  manifest.name = productName;
  manifest.icons = [
    {
      src: 'images/icons/android/android-launchericon-192-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: 'images/icons/android/android-launchericon-512-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
  ];

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
};

const patchFrontendBundles = async () => {
  const assetRoot = path.join(frontRoot, 'assets');
  const assetFiles = (await walk(assetRoot)).filter((file) =>
    file.endsWith('.js'),
  );
  const replacements = [
    ['Welcome to your workspace', `Welcome to ${productName}`],
    ['Welcome to Twenty', `Welcome to ${productName}`],
    ['Welcome to CRM by Elivate', `Welcome to ${productName}`],
    ['Page Not Found | Twenty', `Page Not Found | ${productName}`],
    ['Page Not Found | CRM by Elivate', `Page Not Found | ${productName}`],
  ];
  const counts = new Map(replacements.map(([from]) => [from, 0]));
  const brandedBundleNames = new Set();

  for (const assetPath of assetFiles) {
    let asset = await readFile(assetPath, 'utf8');
    let changed = false;

    for (const [from, to] of replacements) {
      const result = replaceAllWithCount(asset, from, to);

      if (result.count > 0) {
        counts.set(from, counts.get(from) + result.count);
        asset = result.content;
        changed = true;
      }
    }

    if (changed) {
      await writeFile(assetPath, asset);
    }

    if (
      changed ||
      asset.includes(`Welcome to ${productName}`) ||
      asset.includes(`Page Not Found | ${productName}`)
    ) {
      brandedBundleNames.add(path.basename(assetPath));
    }
  }

  if (
    counts.get('Welcome to your workspace') === 0 &&
    brandedBundleNames.size === 0
  ) {
    throw new Error(
      'Twenty onboarding heading was not found. Review the branding patch before upgrading the base image.',
    );
  }

  console.log(
    `Applied ${productName} branding to ${[...counts.values()].reduce(
      (total, count) => total + count,
      0,
    )} frontend bundle strings.`,
  );

  return [...brandedBundleNames].sort();
};

const patchStaticAssetCaching = async (brandedBundleNames) => {
  const appModulePath = path.join(serverDistRoot, 'app.module.js');
  let appModule = await readFile(appModulePath, 'utf8');
  const immutableCacheHeader =
    'public, max-age=31536000, immutable';

  if (appModule.includes(immutableCacheHeader)) {
    return;
  }

  const originalStaticModule = `_servestatic.ServeStaticModule.forRoot({
                rootPath: frontPath
            })`;
  const brandedBundleSet = JSON.stringify(brandedBundleNames);
  const cachedStaticModule = `_servestatic.ServeStaticModule.forRoot({
                rootPath: frontPath,
                serveStaticOptions: {
                    setHeaders: (response, filePath) => {
                        const assetPathSegment = _path.sep + 'assets' + _path.sep;
                        const isHashedAsset = filePath.includes(assetPathSegment) && /-[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9]+$/.test(filePath);
                        if (!isHashedAsset) return;
                        const brandedBundles = new Set(${brandedBundleSet});
                        response.setHeader('Cache-Control', brandedBundles.has(_path.basename(filePath)) ? 'public, max-age=3600' : '${immutableCacheHeader}');
                    }
                }
            })`;
  const result = replaceAllWithCount(
    appModule,
    originalStaticModule,
    cachedStaticModule,
  );

  if (result.count !== 1) {
    throw new Error(
      `Expected one Twenty static module configuration, found ${result.count}. Review the cache patch before upgrading the base image.`,
    );
  }

  appModule = result.content;
  await writeFile(appModulePath, appModule);
};

const patchFavicon = async () => {
  // Twenty ships its own favicon.ico, which the icon directory copy does not
  // replace, so the browser tab keeps the upstream mark until this overwrites it.
  const source = '/tmp/brand/favicon.ico';
  const target = path.join(frontRoot, 'favicon.ico');

  try {
    await copyFile(source, target);
    console.log('Applied Elivate Network favicon.');
  } catch (error) {
    throw new Error(`Could not apply favicon: ${error.message}`);
  }
};

await patchIndex();
await patchFavicon();
await patchManifest();
const brandedBundleNames = await patchFrontendBundles();
await patchStaticAssetCaching(brandedBundleNames);
