#!/usr/bin/env node
// Mock of Mindwtr's Local API (apps/desktop/src-tauri/src/local_api.rs) for testing
// QuickAdd without Mindwtr. In-memory areas/projects/tasks, bearer auth, logs POST bodies.
//
//   node scripts/mock-local-api.mjs [--port 3456] [--token dev-token]
//
// Point QuickAdd at it with Settings (port + token overrides), or start the app
// with env QUICKADD_API_PORT / QUICKADD_API_TOKEN (see README).
//
// Mirrors the real server's behaviour that matters to QuickAdd:
//   GET /health -> {ok:true}; GET /areas (also /v1/areas) -> {areas}; GET /projects -> {projects}
//   GET /tasks[?all=1] -> {tasks} (done/archived hidden unless all=1)
//   POST /tasks {title|input, props} -> 201 {task}; unknown top-level keys or props.title -> 400
//   POST /projects {title, props:{areaId?}} -> 201 {project}
//   Missing/wrong bearer -> 401 {error:"Unauthorized"}; unknown route -> 404 {error:"Not found"}
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(arg('port', process.env.MOCK_API_PORT ?? '3456'));
const TOKEN = arg('token', process.env.MOCK_API_TOKEN ?? 'dev-token');

const now = () => new Date().toISOString();
const t0 = now();
const areas = [
  { id: 'area-work', name: 'Work', color: '#2563eb', order: 0, createdAt: t0, updatedAt: t0 },
  { id: 'area-home', name: 'Home', color: '#16a34a', order: 1, createdAt: t0, updatedAt: t0 },
  { id: 'area-old', name: 'Old', order: 2, createdAt: t0, updatedAt: t0, deletedAt: t0 },
];
const projects = [
  { id: 'proj-website', title: 'Website relaunch', status: 'active', color: '#2563eb', order: 0, tagIds: [], areaId: 'area-work', createdAt: t0, updatedAt: t0 },
  { id: 'proj-garden', title: 'Garden', status: 'active', color: '#16a34a', order: 1, tagIds: [], areaId: 'area-home', createdAt: t0, updatedAt: t0 },
];
const tasks = [
  { id: 'task-1', title: 'Existing task', status: 'next', tags: ['#idea'], contexts: ['@phone'], createdAt: t0, updatedAt: t0 },
  { id: 'task-2', title: 'Old done task', status: 'done', tags: ['#archive'], contexts: ['@errands'], createdAt: t0, updatedAt: t0 },
];

// Subset of sanitize_task_patch_map's accepted keys (enough to flag typos).
const ALLOWED_PROPS = new Set([
  'status', 'priority', 'tags', 'contexts', 'dueDate', 'startTime', 'reviewAt', 'projectId', 'areaId',
  'sectionId', 'description', 'assignedTo', 'energyLevel', 'timeEstimate', 'isFocusedToday', 'attachments',
  'checklist', 'recurrence', 'location', 'taskMode', 'reminderPolicy', 'suppressMindwtrReminders',
  'focusedAt', 'order', 'orderNum', 'textDirection', 'waitingFor', 'waitingSince',
]);
const STATUSES = new Set(['inbox', 'next', 'waiting', 'someday', 'reference', 'done', 'archived']);

function validAttachments(value) {
  if (!Array.isArray(value)) return false;
  return value.every((a) => {
    if (!a || typeof a !== 'object') return false;
    for (const key of ['id', 'kind', 'title', 'uri', 'createdAt', 'updatedAt']) {
      if (typeof a[key] !== 'string' || !a[key].trim()) return false;
    }
    if (a.kind !== 'file' && a.kind !== 'link') return false;
    const known = new Set(['id', 'kind', 'title', 'uri', 'createdAt', 'updatedAt', 'mimeType', 'deletedAt', 'fileHash', 'staleContentHash', 'pendingContentUpload', 'cloudKey', 'size', 'contentRev', 'contentMtimeMs', 'contentSize', 'localStatus']);
    return Object.keys(a).every((k) => known.has(k));
  });
}

function createTask(body) {
  const unsupported = Object.keys(body).filter((k) => !['input', 'title', 'props'].includes(k));
  if (unsupported.length) throw new Error(`Unsupported task creation fields: ${unsupported.join(', ')}`);
  const title = String(body.title ?? '').trim() || String(body.input ?? '').trim();
  if (!title) throw new Error('Task title is required');
  const props = body.props ?? {};
  if (typeof props !== 'object' || Array.isArray(props)) throw new Error('Invalid task props');
  if ('title' in props) throw new Error('Unsupported task props: title');
  for (const key of Object.keys(props)) {
    if (!ALLOWED_PROPS.has(key)) throw new Error(`Unsupported task field: ${key}`);
  }
  if (props.status && !STATUSES.has(props.status)) throw new Error(`Invalid status: ${props.status}`);
  if (props.attachments != null && !validAttachments(props.attachments)) throw new Error('Invalid attachments');
  if (props.projectId && !projects.some((p) => p.id === props.projectId)) throw new Error('Project not found');
  if (props.areaId && !areas.some((a) => a.id === props.areaId && !a.deletedAt)) throw new Error('Area not found');
  const stamp = now();
  const task = {
    tags: [],
    contexts: [],
    taskMode: 'task',
    pushCount: 0,
    reminderPolicy: 'inherit',
    ...Object.fromEntries(Object.entries(props).filter(([, v]) => v !== null)),
    id: randomUUID(),
    title,
    createdAt: stamp,
    updatedAt: stamp,
  };
  task.status ??= props.startTime ? 'next' : 'inbox';
  tasks.push(task);
  return task;
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), Connection: 'close' });
  res.end(text);
}

const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const method = req.method ?? 'GET';
    const raw = Buffer.concat(chunks).toString('utf8');
    const log = (status) => console.log(`${new Date().toLocaleTimeString()} ${method} ${url.pathname}${url.search} -> ${status}`);
    if (method === 'OPTIONS') return send(res, 200, { ok: true });
    const auth = (req.headers.authorization ?? '').trim().split(/\s+/);
    if (!(auth.length === 2 && auth[0].toLowerCase() === 'bearer' && auth[1] === TOKEN)) {
      log(401);
      return send(res, 401, { error: 'Unauthorized' });
    }
    try {
      if (method === 'GET' && url.pathname === '/health') return log(200), send(res, 200, { ok: true });
      if (method === 'GET' && (url.pathname === '/areas' || url.pathname === '/v1/areas')) {
        log(200);
        return send(res, 200, { areas: areas.filter((a) => !a.deletedAt) });
      }
      if (method === 'GET' && url.pathname === '/projects') return log(200), send(res, 200, { projects });
      if (method === 'GET' && url.pathname === '/tasks') {
        const all = url.searchParams.get('all') === '1';
        log(200);
        return send(res, 200, { tasks: tasks.filter((t) => all || (t.status !== 'done' && t.status !== 'archived')) });
      }
      if (method === 'POST' && url.pathname === '/tasks') {
        let body;
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          log(400);
          return send(res, 400, { error: 'Invalid JSON body' });
        }
        console.log('  POST body:', JSON.stringify(body));
        try {
          const task = createTask(body);
          log(201);
          return send(res, 201, { task });
        } catch (error) {
          const message = String(error.message ?? error);
          const status = /not found/i.test(message) ? 404 : 400;
          log(status);
          console.log(`  error: ${message}`);
          return send(res, status, { error: message });
        }
      }
      if (method === 'POST' && url.pathname === '/projects') {
        const body = raw ? JSON.parse(raw) : {};
        console.log('  POST body:', JSON.stringify(body));
        const unsupported = Object.keys(body).filter((k) => k !== 'title' && k !== 'props');
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const areaId = body.props?.areaId;
        const error = unsupported.length
          ? `Unsupported project field: ${unsupported[0]}`
          : !title
            ? 'Project title is required'
            : areaId && !areas.some((a) => a.id === areaId && !a.deletedAt)
              ? 'Area not found'
              : null;
        if (error) {
          const status = /not found/i.test(error) ? 404 : 400;
          log(status);
          return send(res, status, { error });
        }
        const stamp = now();
        const area = areas.find((a) => a.id === areaId);
        const project = {
          id: randomUUID(), title, status: 'active', color: area?.color ?? '#6B7280', order: projects.length,
          tagIds: [], ...(areaId ? { areaId } : {}), createdAt: stamp, updatedAt: stamp,
        };
        projects.push(project);
        log(201);
        return send(res, 201, { project });
      }
      log(404);
      return send(res, 404, { error: 'Not found' });
    } catch (error) {
      log(500);
      return send(res, 500, { error: String(error) });
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock Mindwtr Local API on http://127.0.0.1:${PORT} (token: ${TOKEN})`);
});
const shutdown = () => {
  console.log(`tasks created this session: ${tasks.length - 2}`);
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
