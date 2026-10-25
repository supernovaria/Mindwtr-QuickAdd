// HTTP client for Mindwtr's Local API (127.0.0.1 only, bearer auth).
// Routes and response shapes follow local_api.rs: GET /health -> {ok},
// GET /areas -> {areas}, GET /projects -> {projects}, GET /tasks?all=1 -> {tasks},
// POST /tasks {title, props} -> 201 {task}; errors are {error: string}.
import type { Area, Project, Task } from '../../vendor/mindwtr-core/src/types';
import type {
  ApiError,
  ApiResult,
  CreateTaskInput,
  CreateTaskOutcome,
  KnownTokens,
  Settings,
} from '../preload/api';
import { resolveConnection, type ResolvedConnection } from './local-api-config';

const REQUEST_TIMEOUT_MS = 5000;

export const ENABLE_HINT =
  'In Mindwtr, open Settings → Integrations and turn on "Enable local API server", then try again.';

type SettingsSource = () => Pick<Settings, 'apiPort' | 'apiToken'>;

export class LocalApiClient {
  private tokensCache: { at: number; value: KnownTokens } | null = null;

  constructor(private readonly settings: SettingsSource) {}

  connection(): ResolvedConnection {
    return resolveConnection(this.settings());
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResult<T>> {
    const conn = this.connection();
    if (!conn.token) {
      return fail({
        code: 'no-token',
        message:
          conn.enabledInConfig === false || conn.configDir === null
            ? `Mindwtr's Local API is off. ${ENABLE_HINT}`
            : 'No Local API token found in Mindwtr\'s config. Copy the token from Mindwtr (Settings → Integrations) into QuickAdd Settings.',
      });
    }
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${conn.port}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${conn.token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return fail({
        code: 'unreachable',
        message:
          conn.enabledInConfig === false
            ? `Mindwtr's Local API is off. ${ENABLE_HINT}`
            : `Can't reach Mindwtr on 127.0.0.1:${conn.port}. Make sure Mindwtr is running with the Local API enabled (Settings → Integrations).`,
      });
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (!response.ok) {
      const serverMessage =
        json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string'
          ? (json as { error: string }).error
          : `HTTP ${response.status}`;
      if (response.status === 401) {
        return fail({
          code: 'unauthorized',
          status: 401,
          message:
            conn.tokenSource === 'settings'
              ? 'Mindwtr rejected the API token set in QuickAdd Settings. Clear it to auto-detect, or paste the current token.'
              : 'Mindwtr rejected the API token. Restart Mindwtr or set the token in QuickAdd Settings.',
        });
      }
      if (response.status === 403 && /read-only/i.test(serverMessage)) {
        return fail({
          code: 'read-only',
          status: 403,
          message: "Mindwtr's Local API is read-only, so QuickAdd can't create tasks. Allow writes in Mindwtr's Local API settings.",
        });
      }
      return fail({ code: 'http', status: response.status, message: `Mindwtr: ${serverMessage}` });
    }
    return { ok: true, data: json as T };
  }

  async health(): Promise<ApiResult<{ ok: boolean }>> {
    return this.request('GET', '/health');
  }

  async listAreas(): Promise<ApiResult<Area[]>> {
    const result = await this.request<{ areas?: Area[] }>('GET', '/areas');
    if (!result.ok) return result;
    const areas = (result.data.areas ?? []).filter((a) => !a.deletedAt);
    areas.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
    return { ok: true, data: areas };
  }

  async listProjects(): Promise<ApiResult<Project[]>> {
    const result = await this.request<{ projects?: Project[] }>('GET', '/projects');
    if (!result.ok) return result;
    return { ok: true, data: (result.data.projects ?? []).filter((p) => !p.deletedAt) };
  }

  /** Contexts and tags already in use, for the parser's suggestions. Cached for a minute. */
  async knownTokens(): Promise<ApiResult<KnownTokens>> {
    if (this.tokensCache && Date.now() - this.tokensCache.at < 60_000) {
      return { ok: true, data: this.tokensCache.value };
    }
    const result = await this.request<{ tasks?: Task[] }>('GET', '/tasks?all=1');
    if (!result.ok) return result;
    const contexts = new Set<string>();
    const tags = new Set<string>();
    for (const task of result.data.tasks ?? []) {
      for (const c of task.contexts ?? []) if (typeof c === 'string') contexts.add(c);
      for (const t of task.tags ?? []) if (typeof t === 'string') tags.add(t);
    }
    const value = { contexts: [...contexts].sort(), tags: [...tags].sort() };
    this.tokensCache = { at: Date.now(), value };
    return { ok: true, data: value };
  }

  /** POST /projects {title, props:{areaId}} -> 201 {project} (create_project_from_body). */
  async createProject(title: string, areaId?: string): Promise<ApiResult<Project>> {
    const result = await this.request<{ project?: Project }>('POST', '/projects', {
      title,
      props: areaId ? { areaId } : {},
    });
    if (!result.ok) return result;
    if (!result.data.project?.id) return fail({ code: 'http', message: 'Mindwtr returned no project id.' });
    return { ok: true, data: result.data.project };
  }

  /**
   * Creates tasks one by one. New projects (`item.newProject`) are created
   * first, once per name+area within the batch. Stops early on connection/auth errors.
   */
  async createTasks(items: CreateTaskInput[]): Promise<CreateTaskOutcome[]> {
    const outcomes: CreateTaskOutcome[] = [];
    const createdProjects = new Map<string, ApiResult<Project>>();
    let fatal: ApiError | null = null;
    for (const item of items) {
      if (fatal) {
        outcomes.push({ ok: false, error: fatal });
        continue;
      }
      const props: Record<string, unknown> = { ...(item.props ?? {}) };
      const newTitle = item.newProject?.title.trim();
      if (newTitle && !props.projectId) {
        const areaId = item.newProject?.areaId;
        const key = `${newTitle.toLowerCase()}|${areaId ?? ''}`;
        let project = createdProjects.get(key);
        if (!project) {
          project = await this.createProject(newTitle, areaId);
          createdProjects.set(key, project);
        }
        if (!project.ok) {
          outcomes.push({
            ok: false,
            error: { ...project.error, message: `Couldn't create project "${newTitle}": ${project.error.message}` },
          });
          if (project.error.code !== 'http') fatal = project.error;
          continue;
        }
        props.projectId = project.data.id;
        delete props.areaId;
      }
      const result = await this.request<{ task?: Task }>('POST', '/tasks', {
        title: item.title,
        props,
      });
      if (result.ok) {
        outcomes.push({ ok: true, task: result.data.task });
      } else {
        outcomes.push({ ok: false, error: result.error });
        if (result.error.code !== 'http') fatal = result.error;
      }
    }
    this.tokensCache = null;
    return outcomes;
  }
}

function fail(error: ApiError): ApiResult<never> {
  return { ok: false, error };
}
