#!/usr/bin/env node

const { execSync } = require('child_process');
const { readFileSync } = require('fs');

// Generate new version
const cdkVersion = JSON.parse(readFileSync('lerna.json')).version;

const prevForkVersion = execSync('npm show @serverless-stack/aws-cdk version').toString().trim();
const prevCdkVersion = prevForkVersion.split('-')[0];
const prevRevision = prevForkVersion.split('.').pop();
const revision = prevCdkVersion === cdkVersion
  ? parseInt(prevRevision) + 1
  : 1;

const forkVersion = `${cdkVersion}-rc.${revision}`;

// Tag
execSync(`git tag v${forkVersion} && git push --tags`);

// Publish
execSync(`scripts/align-version.sh`);
execSync(`cd packages/aws-cdk && sed -i '' "s/\\"name\\": \\"aws-cdk\\"/\\"name\\": \\"@serverless-stack\\/aws-cdk\\"/g" package.json`);
execSync(`cd packages/aws-cdk && sed -i '' "s/\\"version\\": \\"${cdkVersion}\\"/\\"version\\": \\"${forkVersion}\\"/g" package.json`);
execSync(`npm publish --access public`);
execSync(`git reset --hard`);
