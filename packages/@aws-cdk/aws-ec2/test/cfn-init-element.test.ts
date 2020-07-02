import { App, Duration, Stack } from '@aws-cdk/core';
import * as s3 from '@aws-cdk/aws-s3';
import * as ec2 from '../lib';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DEFAULT_LINUX_OPTIONS = {
  platform: ec2.InitRenderPlatform.LINUX,
  index: 0,
};
const DEFAULT_WINDOWS_OPTIONS = {
  platform: ec2.InitRenderPlatform.WINDOWS,
  index: 0,
};

describe('InitCommand', () => {

  test('throws error on empty argv command', () => {
    expect(() => { ec2.InitCommand.argvCommand([]) }).toThrow();
  });

  test('auto-generates an indexed command key if none is provided', () => {
    // GIVEN
    const command = ec2.InitCommand.shellCommand('/bin/sh');

    // WHEN
    const rendered = command.renderElement({
      platform: ec2.InitRenderPlatform.LINUX,
      index: 1,
    });

    // THEN
    expect(rendered['001']).toBeDefined();
  });

  test('renders a minimalist template when no options are defined', () => {
    // GIVEN
    const command = ec2.InitCommand.shellCommand('/bin/sh');

    // WHEN
    const rendered = command.renderElement({
      platform: ec2.InitRenderPlatform.LINUX,
      index: 1,
    });

    // THEN
    expect(rendered).toEqual({
      '001': { command: '/bin/sh' },
    });
  });

  test('creates a shell command with all provided options', () => {
    // GIVEN
    const command = ec2.InitCommand.shellCommand('/bin/sh', {
      key: 'command_0',
      env: { 'SECRETS_FILE': '/tmp/secrets' },
      cwd: '/home/myUser',
      test: 'test -d /home/myUser',
      ignoreErrors: false,
      waitAfterCompletion: Duration.hours(2),
    });

    // WHEN
    const rendered = command.renderElement(DEFAULT_WINDOWS_OPTIONS);

    // THEN
    expect(rendered).toEqual({
      'command_0': {
        command: '/bin/sh',
        env: { 'SECRETS_FILE': '/tmp/secrets' },
        cwd: '/home/myUser',
        test: 'test -d /home/myUser',
        ignoreErrors: false,
        waitAfterCompletion: 7200,
      },
    });
  });

  test('creates an argv command with all provided options', () => {
    // GIVEN
    const command = ec2.InitCommand.argvCommand(['/bin/sh', '-c', 'doStuff'], {
      key: 'command_0',
      env: { 'SECRETS_FILE': '/tmp/secrets' },
      cwd: '/home/myUser',
      test: 'test -d /home/myUser',
      ignoreErrors: false,
      waitAfterCompletion: Duration.hours(2),
    });

    // WHEN
    const rendered = command.renderElement(DEFAULT_WINDOWS_OPTIONS);

    // THEN
    expect(rendered).toEqual({
      'command_0': {
        command: ['/bin/sh', '-c', 'doStuff'],
        env: { 'SECRETS_FILE': '/tmp/secrets' },
        cwd: '/home/myUser',
        test: 'test -d /home/myUser',
        ignoreErrors: false,
        waitAfterCompletion: 7200,
      },
    });
  });

  test('errors when waitAfterCompletion is specified for Linux systems', () => {
    // GIVEN
    const command = ec2.InitCommand.shellCommand('/bin/sh', {
      key: 'command_0',
      env: { 'SECRETS_FILE': '/tmp/secrets' },
      cwd: '/home/myUser',
      test: 'test -d /home/myUser',
      ignoreErrors: false,
      waitAfterCompletion: Duration.hours(2),
    });

    // THEN
    expect(() => {
      command.renderElement(DEFAULT_LINUX_OPTIONS);
    }).toThrow(/'waitAfterCompletion' is only valid for Windows/);
  });

});

describe('InitFile', () => {

  test('fromString creates inline content', () => {
    // GIVEN
    const file = ec2.InitFile.fromString('/tmp/foo', 'My content');

    // WHEN
    const rendered = file.renderElement(DEFAULT_LINUX_OPTIONS);

    // THEN
    expect(rendered).toEqual({
      '/tmp/foo': {
        content: 'My content',
        encoding: 'plain',
        owner: 'root',
        group: 'root',
        mode: '000644',
      },
    });
  });

  test('fromString creates inline content from base64-encoded content', () => {
    // GIVEN
    const file = ec2.InitFile.fromString('/tmp/foo', Buffer.from('Hello').toString('base64'), {
      base64Encoded: true,
    });

    // WHEN
    const rendered = file.renderElement(DEFAULT_LINUX_OPTIONS);

    // THEN
    expect(rendered).toEqual({
      '/tmp/foo': {
        content: 'SGVsbG8=',
        encoding: 'base64',
        owner: 'root',
        group: 'root',
        mode: '000644',
      },
    });
  });

  test('mode, user, group settings not allowed for Windows', () => {
    // GIVEN
    const file = ec2.InitFile.fromString('/tmp/foo', 'My content', {
      group: 'root',
      owner: 'root',
      mode: '000644',
    });

    // WHEN
    expect(() => {
      file.renderElement(DEFAULT_WINDOWS_OPTIONS);
    }).toThrow('Owner, group, and mode options not supported for Windows.');
  });

  test('symlink throws an error if mode is set incorrectly', () => {
    expect(() => {
      ec2.InitFile.symlink('/tmp/foo', '/tmp/bar', {
        mode: '000644',
      });
    }).toThrow('File mode for symlinks must begin with 120XXX');
  });

  test('symlink sets mode is not set', () => {
    // GIVEN
    const file = ec2.InitFile.symlink('/tmp/foo', '/tmp/bar');

    // WHEN
    const rendered = file.renderElement(DEFAULT_LINUX_OPTIONS);

    // THEN
    expect(rendered).toEqual({
      '/tmp/foo': {
        content: '/tmp/bar',
        encoding: 'plain',
        owner: 'root',
        group: 'root',
        mode: '120644',
      },
    });
  });

  test('fromFileInline renders the file contents inline', () => {
    // GIVEN
    const tmpFilePath = createTmpFileWithContent('Hello World!');
    const file = ec2.InitFile.fromFileInline('/tmp/foo', tmpFilePath);

    // WHEN
    const rendered = file.renderElement(DEFAULT_LINUX_OPTIONS);

    // THEN
    expect(rendered).toEqual({
      '/tmp/foo': {
        content: 'Hello World!',
        encoding: 'plain',
        owner: 'root',
        group: 'root',
        mode: '000644',
      },
    });
  });

  test('fromObject renders the contents inline as an object', () => {
    // GIVEN
    const content = {
      version: '1234',
      secretsFile: '/tmp/secrets',
    };
    const file = ec2.InitFile.fromObject('/tmp/foo', content);

    // WHEN
    const rendered = file.renderElement(DEFAULT_LINUX_OPTIONS);

    // THEN
    expect(rendered).toEqual({
      '/tmp/foo': {
        content: {
          version: '1234',
          secretsFile: '/tmp/secrets',
        },
        owner: 'root',
        group: 'root',
        mode: '000644',
      },
    });
  });

  test('fromFileInline respects the base64 flag', () => {
    // GIVEN
    const tmpFilePath = createTmpFileWithContent('Hello');
    const file = ec2.InitFile.fromFileInline('/tmp/foo', tmpFilePath, {
      base64Encoded: true,
    });

    // WHEN
    const rendered = file.renderElement(DEFAULT_LINUX_OPTIONS);

    // THEN
    expect(rendered).toEqual({
      '/tmp/foo': {
        content: 'SGVsbG8=',
        encoding: 'base64',
        owner: 'root',
        group: 'root',
        mode: '000644',
      },
    });
  });

  test('fromUrl uses the provided URL as a source', () => {
    // GIVEN
    const file = ec2.InitFile.fromUrl('/tmp/foo', 'https://aws.amazon.com/');

    // WHEN
    const rendered = file.renderElement(DEFAULT_LINUX_OPTIONS);

    // THEN
    expect(rendered).toEqual({
      '/tmp/foo': {
        source: 'https://aws.amazon.com/',
        owner: 'root',
        group: 'root',
        mode: '000644',
      },
    });
  });

});

describe('InitGroup', () => {

  test('renders without a group id', () => {
    // GIVEN
    const group = ec2.InitGroup.fromName('amazon');

    // WHEN
    const rendered = group.renderElement(DEFAULT_LINUX_OPTIONS);

    // THEN
    expect(rendered).toEqual({ amazon: {} });
  });

  test('renders with a group id', () => {
    // GIVEN
    const group = ec2.InitGroup.fromName('amazon', 42);

    // WHEN
    const rendered = group.renderElement(DEFAULT_LINUX_OPTIONS);

    // THEN
    expect(rendered).toEqual({ amazon: { gid: 42 } });
  });

  test('groups are not supported for Windows', () => {
    // GIVEN
    const group = ec2.InitGroup.fromName('amazon');

    // WHEN
    expect(() => {
      group.renderElement(DEFAULT_WINDOWS_OPTIONS);
    }).toThrow('Init groups are not supported on Windows');
  });

});

describe('InitUser', () => {

  test('fromName accepts just a name to create a user', () => {
    // GIVEN
    const group = ec2.InitUser.fromName('sysuser1');

    // WHEN
    const rendered = group.renderElement(DEFAULT_LINUX_OPTIONS);

    // THEN
    expect(rendered).toEqual({ sysuser1: {} });
  });

  test('renders with all options present', () => {
    // GIVEN
    const group = ec2.InitUser.fromName('sysuser1', {
      userId: 42,
      homeDir: '/home/sysuser1',
      groups: ['amazon'],
    });

    // WHEN
    const rendered = group.renderElement(DEFAULT_LINUX_OPTIONS);

    // THEN
    expect(rendered).toEqual({
      sysuser1: {
        uid: 42,
        homeDir: '/home/sysuser1',
        groups: ['amazon'],
      },
    });
  });

  test('users are not supported for Windows', () => {
    // GIVEN
    const group = ec2.InitUser.fromName('sysuser1');

    // WHEN
    expect(() => {
      group.renderElement(DEFAULT_WINDOWS_OPTIONS);
    }).toThrow('Init users are not supported on Windows');
  });

});

describe('InitPackage', () => {

  test('rpm auto-generates a name if none is provided', () => {
    // GIVEN
    const pkg = ec2.InitPackage.rpm('https://example.com/rpm/mypkg.rpm');

    // WHEN
    const rendered = pkg.renderElement({
      platform: ec2.InitRenderPlatform.LINUX,
      index: 5,
    });

    // THEN
    expect(rendered).toEqual({
      rpm: {
        '005': ['https://example.com/rpm/mypkg.rpm'],
      },
    });
  });

  test('rpm uses name if provided', () => {
    // GIVEN
    const pkg = ec2.InitPackage.rpm('https://example.com/rpm/mypkg.rpm', 'myPkg');

    // WHEN
    const rendered = pkg.renderElement(DEFAULT_LINUX_OPTIONS);

    // THEN
    expect(rendered).toEqual({
      rpm: {
        myPkg: ['https://example.com/rpm/mypkg.rpm'],
      },
    });
  });

  test('rpm is not supported for Windows', () => {
    // GIVEN
    const pkg = ec2.InitPackage.rpm('https://example.com/rpm/mypkg.rpm');

    // THEN
    expect(() => {
      pkg.renderElement(DEFAULT_WINDOWS_OPTIONS);
    }).toThrow('Windows only supports the MSI package type');
  });

  test.each([
    ['yum', ec2.InitPackage.yum],
    ['rubygems', ec2.InitPackage.rubyGem],
    ['python', ec2.InitPackage.python],
    ['apt', ec2.InitPackage.apt],
  ])('%s accepts a package without versions', (pkgType, fn) => {
    // GIVEN
    const pkg = fn('httpd');

    // WHEN
    const rendered = pkg.renderElement(DEFAULT_LINUX_OPTIONS);

    // THEN
    expect(rendered).toEqual({
      [pkgType]: { httpd: [] },
    });
  },
  );

  test.each([
    ['yum', ec2.InitPackage.yum],
    ['rubygems', ec2.InitPackage.rubyGem],
    ['python', ec2.InitPackage.python],
    ['apt', ec2.InitPackage.apt],
  ])('%s accepts a package with versions', (pkgType, fn) => {
    // GIVEN
    const pkg = fn('httpd', '1.0', '2.0');

    // WHEN
    const rendered = pkg.renderElement(DEFAULT_LINUX_OPTIONS);

    // THEN
    expect(rendered).toEqual({
      [pkgType]: { httpd: ['1.0', '2.0'] },
    });
  },
  );

  test.each([
    ['yum', ec2.InitPackage.yum],
    ['rubygems', ec2.InitPackage.rubyGem],
    ['python', ec2.InitPackage.python],
    ['apt', ec2.InitPackage.apt],
  ])('%s is not supported on Windows', (_pkgType, fn) => {
    // GIVEN
    const pkg = fn('httpd');

    expect(() => {
      pkg.renderElement(DEFAULT_WINDOWS_OPTIONS);
    }).toThrow('Windows only supports the MSI package type');
  },
  );

  test('msi auto-generates a name if none is provided', () => {
    // GIVEN
    const pkg = ec2.InitPackage.msi('https://example.com/rpm/mypkg.msi');

    // WHEN
    const rendered = pkg.renderElement({
      platform: ec2.InitRenderPlatform.WINDOWS,
      index: 7,
    });

    // THEN
    expect(rendered).toEqual({
      msi: {
        '007': ['https://example.com/rpm/mypkg.msi'],
      },
    });
  });

  test('msi uses name if provided', () => {
    // GIVEN
    const pkg = ec2.InitPackage.msi('https://example.com/rpm/mypkg.msi', 'myPkg');

    // WHEN
    const rendered = pkg.renderElement(DEFAULT_WINDOWS_OPTIONS);

    // THEN
    expect(rendered).toEqual({
      msi: {
        myPkg: ['https://example.com/rpm/mypkg.msi'],
      },
    });
  });

  test('msi is not supported for Linux', () => {
    // GIVEN
    const pkg = ec2.InitPackage.msi('https://example.com/rpm/mypkg.msi');

    // THEN
    expect(() => {
      pkg.renderElement(DEFAULT_LINUX_OPTIONS);
    }).toThrow('MSI installers are only supported on Windows systems.');
  });

});

describe('InitService', () => {

  test.each([
    ['Linux', 'sysvinit', DEFAULT_LINUX_OPTIONS],
    ['Windows', 'windows', DEFAULT_WINDOWS_OPTIONS],
  ])('enable always sets enabled and running to true for %s', (_platform, key, options) => {
    // GIVEN
    const service = ec2.InitService.enable('httpd');

    // WHEN
    const rendered = service.renderElement(options);

    // THEN
    expect(rendered[key]).toBeDefined();
    expect(rendered[key]).toEqual({
      httpd: {
        enabled: true,
        ensureRunning: true,
      },
    });
  });

  test.each([
    ['Linux', 'sysvinit', DEFAULT_LINUX_OPTIONS],
    ['Windows', 'windows', DEFAULT_WINDOWS_OPTIONS],
  ])('disable returns a minimalist disabled service for %s', (_platform, key, options) => {
    // GIVEN
    const service = ec2.InitService.disable('httpd');

    // WHEN
    const rendered = service.renderElement(options);

    // THEN
    expect(rendered[key]).toBeDefined();
    expect(rendered[key]).toEqual({
      httpd: {
        enabled: false,
        ensureRunning: false,
      },
    });
  });
  test.each([
    ['Linux', 'sysvinit', DEFAULT_LINUX_OPTIONS],
    ['Windows', 'windows', DEFAULT_WINDOWS_OPTIONS],
  ])('fromOptions renders all options for %s', (_platform, key, options) => {
    // GIVEN
    const service = ec2.InitService.fromOptions('httpd', {
      enabled: true,
      ensureRunning: true,
      restartAfterFiles: ['/etc/my.cnf'],
      restartAfterSources: ['/tmp/foo'],
      restartAfterPackages: { 'yum': ['httpd'] },
      restartAfterCommands: ['cmd_000'],
    });

    // WHEN
    const rendered = service.renderElement(options);

    // THEN
    expect(rendered[key]).toBeDefined();
    expect(rendered[key]).toEqual({
      httpd: {
        enabled: true,
        ensureRunning: true,
        files: ['/etc/my.cnf'],
        sources: ['/tmp/foo'],
        packages: { 'yum': ['httpd'] },
        commands: ['cmd_000'],
      },
    });
  });

});


describe('InitSource', () => {

  test('fromUrl renders correctly', () => {
    // GIVEN
    const source = ec2.InitSource.fromUrl('/tmp/foo', 'https://example.com/archive.zip');

    // WHEN
    const rendered = source.renderElement(DEFAULT_LINUX_OPTIONS);

    // THEN
    expect(rendered).toEqual({
      '/tmp/foo': 'https://example.com/archive.zip',
    })
  });

  test('fromGitHub builds a path to the tarball', () => {
    // GIVEN
    const source = ec2.InitSource.fromGitHub('/tmp/foo', 'aws', 'aws-cdk', 'master');

    // WHEN
    const rendered = source.renderElement(DEFAULT_LINUX_OPTIONS);

    // THEN
    expect(rendered).toEqual({
      '/tmp/foo': 'https://github.com/aws/aws-cdk/tarball/master',
    })
  });

  test('fromGitHub defaults to master if refspec is omitted', () => {
    // GIVEN
    const source = ec2.InitSource.fromGitHub('/tmp/foo', 'aws', 'aws-cdk');

    // WHEN
    const rendered = source.renderElement(DEFAULT_LINUX_OPTIONS);

    // THEN
    expect(rendered).toEqual({
      '/tmp/foo': 'https://github.com/aws/aws-cdk/tarball/master',
    })
  });

  test('fromS3Object uses object URL', () => {
    // GIVEN
    const app = new App();
    const stack = new Stack(app, 'Stack', {
      env: { account: '1234', region: 'testregion' },
    });
    const bucket = s3.Bucket.fromBucketName(stack, 'bucket', 'MyBucket');
    const source = ec2.InitSource.fromS3Object('/tmp/foo', bucket, 'myKey');

    // WHEN
    const rendered = source.renderElement(DEFAULT_LINUX_OPTIONS);

    // THEN
    expect(rendered).toEqual({
      '/tmp/foo': 'TODOFIXME',
    })
  });

});

function createTmpFileWithContent(content: string): string {
  const suffix = crypto.randomBytes(4).toString('hex');
  const fileName = path.join(os.tmpdir(), `cfn-init-element-test-${suffix}`);
  fs.writeFileSync(fileName, content);
  return fileName;
}