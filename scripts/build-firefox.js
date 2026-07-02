import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distPath = path.join(__dirname, '..', 'dist');
const ffDistPath = path.join(__dirname, '..', 'dist-firefox');

// Copy dist to dist-firefox
if (fs.existsSync(ffDistPath)) {
  fs.rmSync(ffDistPath, { recursive: true, force: true });
}
fs.cpSync(distPath, ffDistPath, { recursive: true });

// Read manifest
const manifestPath = path.join(ffDistPath, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Modify background for Firefox
if (manifest.background && manifest.background.service_worker) {
  manifest.background.scripts = [manifest.background.service_worker];
  delete manifest.background.service_worker;
}

// Clean up Firefox unsupported keys
if (manifest.web_accessible_resources) {
  manifest.web_accessible_resources.forEach(resource => {
    delete resource.use_dynamic_url;
  });
}

// Firefox does not recognize the 'windows' permission (the API is available without it)
if (manifest.permissions) {
  manifest.permissions = manifest.permissions.filter(p => p !== 'windows');
}

// Firefox does not support the 'oauth2' manifest key
if (manifest.oauth2) {
  delete manifest.oauth2;
}

// Add browser_specific_settings
manifest.browser_specific_settings = {
  gecko: {
    id: "{9482f5b5-79d3-49dc-8a4b-f2c96c561b3f}",
    strict_min_version: "109.0"
  }
};

// Write manifest back
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log('✅ Firefox build generated successfully in dist-firefox/!');
