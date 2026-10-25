// Finds the port and bearer token of Mindwtr's Local API.
//
// Mindwtr (apps/desktop/src-tauri/src/local_api.rs, read_local_api_config) reads
// three keys from its config, all stored as TOML strings:
//   config.toml   local_api_enabled = "true" | "false"
//                 local_api_port    = "3456"
//   secrets.toml  local_api_token   = "<64 hex chars>"
// (config.rs SECRET_FIELDS moves local_api_token into secrets.toml; older
// configs may still carry it in config.toml, so both files are read.)
//
// Config dir: Store build  %LOCALAPPDATA%\Packages\DongdaLi.Mindwtr_*\LocalCache\Roaming\mindwtr\config
//             other builds %APPDATA%\mindwtr\config
//
// The files are re-read on every request so enabling the API (or rotating the
// token) in Mindwtr takes effect without restarting QuickAdd.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConnectionInfo, Settings } from '../preload/api';

export const DEFAULT_LOCAL_API_PORT = 3456;

export function candidateConfigDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs: string[] = [];
  const localAppData = env.LOCALAPPDATA;
  if (localAppData) {
    const packages = join(localAppData, 'Packages');
    try {
      for (const name of readdirSync(packages)) {
        if (/^DongdaLi\.Mindwtr_/i.test(name)) {
          dirs.push(join(packages, name, 'LocalCache', 'Roaming', 'mindwtr', 'config'));
        }
      }
    } catch {
      // no Packages dir
    }
  }
  if (env.APPDATA) dirs.push(join(env.APPDATA, 'mindwtr', 'config'));
  return dirs;
}

/** Minimal TOML reader for top-level `key = value` pairs (stops at the first table). */
export function parseFlatToml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) break;
    const match = /^([A-Za-z0-9_-]+|"[^"]+")\s*=\s*(.+)$/.exec(line);
    if (!match) continue;
    const key = match[1].replace(/^"|"$/g, '');
    out[key] = parseTomlScalar(match[2]);
  }
  return out;
}

function parseTomlScalar(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"')) {
    let result = '';
    for (let i = 1; i < value.length; i += 1) {
      const ch = value[i];
      if (ch === '"') return result;
      if (ch === '\\' && i + 1 < value.length) {
        const next = value[i + 1];
        i += 1;
        if (next === 'n') result += '\n';
        else if (next === 't') result += '\t';
        else if (next === 'r') result += '\r';
        else if (next === 'u' || next === 'U') {
          const len = next === 'u' ? 4 : 8;
          result += String.fromCodePoint(parseInt(value.slice(i + 1, i + 1 + len), 16));
          i += len;
        } else result += next;
        continue;
      }
      result += ch;
    }
    return result;
  }
  if (value.startsWith("'")) {
    const end = value.indexOf("'", 1);
    return end > 0 ? value.slice(1, end) : value.slice(1);
  }
  return value.replace(/\s+#.*$/, '').trim();
}

function readToml(path: string): Record<string, string> | null {
  try {
    return parseFlatToml(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export interface ResolvedConnection extends ConnectionInfo {
  token: string | null;
}

export function resolveConnection(
  settings: Pick<Settings, 'apiPort' | 'apiToken'>,
  dirs: string[] = candidateConfigDirs(),
): ResolvedConnection {
  let configDir: string | null = null;
  let config: Record<string, string> = {};
  let secrets: Record<string, string> = {};
  for (const dir of dirs) {
    if (!existsSync(join(dir, 'config.toml')) && !existsSync(join(dir, 'secrets.toml'))) continue;
    configDir = dir;
    config = readToml(join(dir, 'config.toml')) ?? {};
    secrets = readToml(join(dir, 'secrets.toml')) ?? {};
    break;
  }

  const configPort = Number.parseInt(config.local_api_port ?? '', 10);
  const validConfigPort = Number.isInteger(configPort) && configPort >= 1024 && configPort <= 65535;
  const port = settings.apiPort ?? (validConfigPort ? configPort : DEFAULT_LOCAL_API_PORT);
  const portSource: ConnectionInfo['portSource'] = settings.apiPort
    ? 'settings'
    : validConfigPort
      ? 'mindwtr-config'
      : 'default';

  const overrideToken = settings.apiToken?.trim() || null;
  const configToken = (secrets.local_api_token ?? config.local_api_token ?? '').trim() || null;
  const token = overrideToken ?? configToken;
  const tokenSource: ConnectionInfo['tokenSource'] = overrideToken
    ? 'settings'
    : configToken
      ? 'mindwtr-config'
      : 'none';

  const enabledRaw = config.local_api_enabled;
  const enabledInConfig =
    enabledRaw === undefined ? null : enabledRaw.trim().toLowerCase() === 'true';

  return { port, portSource, token, tokenSource, configDir, enabledInConfig };
}
