const { existsSync } = require('fs');
const { join } = require('path');
const { spawnSync } = require('child_process');

function isValidJavaHome(javaHome) {
  if (!javaHome) {
    return false;
  }

  const javaExe = join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const jvmCfg = join(javaHome, 'lib', 'jvm.cfg');
  return existsSync(javaExe) && existsSync(jvmCfg);
}

function pickJavaHome() {
  const candidates = [
    process.env.JAVA_HOME,
    'C:\\Program Files\\Android\\Android Studio2\\jbr',
    'C:\\Program Files\\Android\\Android Studio\\jbr',
    join(process.env.USERPROFILE || '', '.jdks', 'jbr-17.0.12'),
    join(process.env.USERPROFILE || '', '.jdks', 'openjdk-20.0.2'),
  ];

  for (const candidate of candidates) {
    if (isValidJavaHome(candidate)) {
      return candidate;
    }
  }

  return null;
}

function pickAndroidHome() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'),
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function pickLatestNdk(androidHome) {
  if (!androidHome) {
    return null;
  }

  const ndkRoot = join(androidHome, 'ndk');
  if (!existsSync(ndkRoot)) {
    return null;
  }

  const { readdirSync, statSync } = require('fs');
  const dirs = readdirSync(ndkRoot)
    .map((name) => join(ndkRoot, name))
    .filter((fullPath) => statSync(fullPath).isDirectory())
    .sort()
    .reverse();

  return dirs[0] || null;
}

const env = { ...process.env };
const javaHome = pickJavaHome();
const androidHome = pickAndroidHome();
const ndkHome = pickLatestNdk(androidHome);
let tauriEntry;

try {
  tauriEntry = require.resolve('@tauri-apps/cli/tauri.js');
} catch {
  tauriEntry = null;
}

if (!javaHome) {
  console.error('No valid JAVA_HOME found for Tauri Android.');
  process.exit(1);
}

env.JAVA_HOME = javaHome;

const javaBin = join(javaHome, 'bin');
const pathSeparator = process.platform === 'win32' ? ';' : ':';
const currentPath = env.Path || env.PATH || '';
const pathParts = [
  javaBin,
  join(process.env.USERPROFILE || '', '.cargo', 'bin'),
  currentPath,
].filter(Boolean);
const mergedPath = pathParts.join(pathSeparator);

env.Path = mergedPath;
env.PATH = mergedPath;

if (androidHome) {
  env.ANDROID_HOME = androidHome;
  env.ANDROID_SDK_ROOT = androidHome;
}

if (ndkHome) {
  env.NDK_HOME = ndkHome;
}

// USB 连接时需要 ADB 端口转发，Android 设备才能访问 PC 的 dev server
// reverse 可能会失败(如设备已离线), 忽略错误继续
const { execSync } = require('child_process');
try { execSync('adb reverse tcp:5173 tcp:5173', { stdio: 'ignore' }); } catch {}
try { execSync('adb reverse tcp:1421 tcp:1421', { stdio: 'ignore' }); } catch {}

const args = process.argv.slice(2);
const command = tauriEntry || (process.platform === 'win32' ? 'tauri.cmd' : 'tauri');

// --host 仅对 dev 子命令有意义，且需通过 -- 透传给 vite
const isDev = args[0] === 'dev';
const baseArgs = tauriEntry ? [tauriEntry, 'android', ...args] : ['android', ...args];
const commandArgs = isDev ? [...baseArgs, '--', '--host', '127.0.0.1'] : baseArgs;

const result = spawnSync(tauriEntry ? process.execPath : command, commandArgs, {
  stdio: 'inherit',
  shell: false,
  env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);