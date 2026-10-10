const fs = require('fs');
const path = require('path');
const vm = require('vm');
const YAML = require('yaml');

const projectRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(projectRoot, 'src');

function checkJavaScript(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      checkJavaScript(filePath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const source = fs.readFileSync(filePath, 'utf8');
      new vm.Script(source, { filename: path.relative(projectRoot, filePath) });
    }
  }
}

checkJavaScript(sourceRoot);
YAML.parse(fs.readFileSync(path.join(sourceRoot, 'docs', 'openapi.yaml'), 'utf8'));
console.log('Build checks passed.');
