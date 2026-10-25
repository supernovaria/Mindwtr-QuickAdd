import { describe, expect, it } from 'vitest';
import type { Area, Project } from '../../vendor/mindwtr-core/src/types';
import { parseBulk, parseCapture, type CaptureContext, type HighlightSpan, type ParsedCapture } from './index';

const NOW = new Date(2026, 9, 21, 10, 30); // Wed 21 Oct 2026, 10:30 local

const project = (id: string, title: string, status: Project['status'] = 'active'): Project =>
    ({ id, title, status, color: '#000', order: 0, tagIds: [], createdAt: '', updatedAt: '' }) as unknown as Project;
const area = (id: string, name: string): Area => ({ id, name, order: 0, createdAt: '', updatedAt: '' });

const ctx: CaptureContext = {
    projects: [project('p1', 'Proj'), project('p2', 'Home Reno'), project('p3', 'Old', 'archived')],
    areas: [area('a1', 'Work'), area('a2', 'Deep Work'), area('a12', '12')],
    knownContexts: ['@at home'],
    now: NOW,
};
const noNumericArea: CaptureContext = { ...ctx, areas: ctx.areas.filter((a) => a.id !== 'a12') };

/** Highlights as `kind:text` strings, for readable assertions. */
function marks(input: string, parsed: Pick<ParsedCapture, 'highlights'>): string[] {
    return parsed.highlights.map((h) => `${h.kind}:${input.slice(h.start, h.end)}`);
}

function expectWellFormed(spans: HighlightSpan[], length: number) {
    for (let i = 0; i < spans.length; i += 1) {
        expect(spans[i].start).toBeGreaterThanOrEqual(0);
        expect(spans[i].end).toBeLessThanOrEqual(length);
        expect(spans[i].end).toBeGreaterThan(spans[i].start);
        if (i > 0) expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end);
    }
}

describe('core syntax regressions', () => {
    it('parses @context #tag +Project /due:', () => {
        const input = 'Call mom @phone #family +Proj /due:tomorrow';
        const r = parseCapture(input, ctx);
        expect(r.title).toBe('Call mom');
        expect(r.props).toEqual({ contexts: ['@phone'], tags: ['#family'], projectId: 'p1', dueDate: '2026-10-22' });
        expect(marks(input, r)).toEqual(['context:@phone', 'tag:#family', 'project:+Proj', 'date:/due:tomorrow']);
        expectWellFormed(r.highlights, input.length);
        expect(r.warnings).toEqual([]);
    });

    it('handles status, focus, energy, estimate, person, note and core priority', () => {
        const input = 'Plan trip %Ana /energy:low /estimate:30m /priority:high /waiting /note:ask about dates';
        const r = parseCapture(input, ctx);
        expect(r.title).toBe('Plan trip');
        expect(r.props).toMatchObject({
            assignedTo: 'Ana', energyLevel: 'low', timeEstimate: '30min', priority: 'high',
            status: 'waiting', description: 'ask about dates',
        });
        expect(marks(input, r)).toEqual([
            'person:%Ana', 'energy:/energy:low', 'estimate:/estimate:30m', 'priority:/priority:high',
            'status:/waiting', 'note:/note:ask about dates',
        ]);
    });

    it('marks the focus command', () => {
        const input = 'Write report /* #q4';
        const r = parseCapture(input, ctx);
        expect(r.props).toMatchObject({ isFocusedToday: true, status: 'next', tags: ['#q4'] });
        expect(marks(input, r)).toEqual(['focus:/*', 'tag:#q4']);
    });

    it('splits a date command around a context core stripped first', () => {
        const input = 'a /due:next @home friday';
        const r = parseCapture(input, ctx);
        expect(r.props).toEqual({ contexts: ['@home'], dueDate: '2026-10-30' });
        expect(marks(input, r)).toEqual(['date:/due:next', 'context:@home', 'date:friday']);
    });

    it('applies a bare natural-language date and highlights it', () => {
        const input = 'Pay rent tomorrow';
        const r = parseCapture(input, ctx);
        expect(r.title).toBe('Pay rent');
        expect(r.props).toEqual({ dueDate: '2026-10-22' });
        expect(marks(input, r)).toEqual(['date:tomorrow']);
    });

    it('keeps escaped markers as text and does not highlight them', () => {
        const input = String.raw`buy \@milk @home`;
        const r = parseCapture(input, ctx);
        expect(r.title).toBe('buy @milk');
        expect(r.props).toEqual({ contexts: ['@home'] });
        expect(marks(input, r)).toEqual(['context:@home']);
    });

    it('matches multi-word known contexts, projects and quoted areas', () => {
        const input = 'x @at home +Home Reno stuff !"Deep Work"';
        const r = parseCapture(input, ctx);
        expect(r.title).toBe('x stuff');
        expect(r.props).toEqual({ contexts: ['@at home'], projectId: 'p2' });
        expect(marks(input, r)).toEqual(['context:@at home', 'project:+Home Reno', 'area:!"Deep Work"']);
    });

    it('reports invalid date commands as warnings and leaves them unhighlighted', () => {
        const input = 'Ship it /due:someday-ish';
        const r = parseCapture(input, ctx);
        expect(r.warnings).toEqual(['Invalid date: /due:someday-ish']);
        expect(r.props.dueDate).toBeUndefined();
        expect(r.highlights).toEqual([]);
    });

    it('hands an unknown project to the client instead of putting it in props', () => {
        const input = 'x +New Thing @a';
        const r = parseCapture(input, ctx, { areaId: 'a1' });
        expect(r.newProject).toEqual({ title: 'New Thing', areaId: 'a1' });
        expect(r.props).toEqual({ contexts: ['@a'] });
        expect(marks(input, r)).toEqual(['project:+New Thing', 'context:@a']);
    });

    it('drops a /project: id the Local API would reject', () => {
        const input = 'x /project:nope';
        const r = parseCapture(input, ctx);
        expect(r.props.projectId).toBeUndefined();
        expect(r.warnings).toEqual(['Unknown or archived project: nope']);
        expect(r.highlights).toEqual([]);
    });
});

describe('extension: !1..!4 priority', () => {
    it.each([
        ['!1', 'urgent'],
        ['!2', 'high'],
        ['!3', 'medium'],
        ['!4', 'low'],
    ])('%s sets priority %s', (token, priority) => {
        const input = `Fix bug ${token} @desk`;
        const r = parseCapture(input, ctx);
        expect(r.title).toBe('Fix bug');
        expect(r.props).toEqual({ priority, contexts: ['@desk'] });
        expect(marks(input, r)).toEqual([`priority:${token}`, 'context:@desk']);
    });

    it('works at the start of the input', () => {
        const r = parseCapture('!1 Fix bug', ctx);
        expect(r.props).toEqual({ priority: 'urgent' });
        expect(r.highlights).toEqual([{ start: 0, end: 2, kind: 'priority' }]);
    });

    it('leaves !Work to core as an area', () => {
        const input = 'Fix bug !Work';
        const r = parseCapture(input, ctx);
        expect(r.props).toEqual({ areaId: 'a1' });
        expect(marks(input, r)).toEqual(['area:!Work']);
    });

    it('leaves !12 to core as an area', () => {
        const input = 'Fix bug !12 @desk';
        const r = parseCapture(input, ctx);
        expect(r.props).toEqual({ areaId: 'a12', contexts: ['@desk'] });
        expect(marks(input, r)).toEqual(['area:!12', 'context:@desk']);
    });

    it('does not treat !12, !5 or !1x as priority', () => {
        for (const token of ['!12', '!5', '!1x', 'a!1']) {
            const r = parseCapture(`Fix bug ${token} @desk`, noNumericArea);
            expect(r.props.priority).toBeUndefined();
            expect(r.title).toBe(`Fix bug ${token}`);
            expect(r.highlights.some((h) => h.kind === 'priority' || h.kind === 'area')).toBe(false);
        }
    });

    it('does not highlight an !Name that matched no area', () => {
        const input = 'Fix bug !Nope';
        const r = parseCapture(input, ctx);
        expect(r.title).toBe('Fix bug !Nope');
        expect(r.props).toEqual({});
        expect(r.highlights).toEqual([]);
    });

    it('combines !1 with an area in the same line', () => {
        const input = 'Fix bug !1 !Work';
        const r = parseCapture(input, ctx);
        expect(r.props).toEqual({ priority: 'urgent', areaId: 'a1' });
        expect(marks(input, r)).toEqual(['priority:!1', 'area:!Work']);
    });

    it('lets an explicit /priority: win and leaves !N as text', () => {
        const input = 'Fix bug !1 /priority:low';
        const r = parseCapture(input, noNumericArea);
        expect(r.props).toEqual({ priority: 'low' });
        expect(marks(input, r)).toEqual(['priority:/priority:low']);
    });

    it('respects an escaped \\!1', () => {
        const r = parseCapture(String.raw`Fix bug \!1 @desk`, ctx);
        expect(r.props.priority).toBeUndefined();
        expect(r.title).toBe('Fix bug !1');
    });
});

describe('extension: markdown links', () => {
    it('becomes a link attachment and keeps the label in the title', () => {
        const input = 'Read [Spec doc](https://ex.com/spec) @desk';
        const r = parseCapture(input, ctx);
        expect(r.title).toBe('Read Spec doc');
        expect(r.props.contexts).toEqual(['@desk']);
        const attachments = r.props.attachments as Array<Record<string, unknown>>;
        expect(attachments).toHaveLength(1);
        expect(attachments[0]).toMatchObject({
            kind: 'link', title: 'Spec doc', uri: 'https://ex.com/spec',
            createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
        });
        expect(typeof attachments[0].id).toBe('string');
        expect(Object.keys(attachments[0]).sort()).toEqual(['createdAt', 'id', 'kind', 'title', 'updatedAt', 'uri']);
        expect(marks(input, r)).toEqual(['link:[Spec doc](https://ex.com/spec)', 'context:@desk']);
    });

    it('keeps markers inside the label as plain text', () => {
        const input = 'See [Issue #12 @bob](https://ex.com/i/12)';
        const r = parseCapture(input, ctx);
        expect(r.title).toBe('See Issue #12 @bob');
        expect(r.props.tags).toBeUndefined();
        expect(r.props.contexts).toBeUndefined();
        expect(marks(input, r)).toEqual(['link:[Issue #12 @bob](https://ex.com/i/12)']);
    });

    it('does not read a date out of the label', () => {
        const input = 'Read [plan for tomorrow](https://ex.com)';
        const r = parseCapture(input, ctx);
        expect(r.title).toBe('Read plan for tomorrow');
        expect(r.props.dueDate).toBeUndefined();
        expect(marks(input, r)).toEqual(['link:[plan for tomorrow](https://ex.com)']);
    });

    it('works before a /link: command', () => {
        const input = '[A](https://a.com) /link:https://b.com';
        const r = parseCapture(input, ctx);
        expect(r.title).toBe('A');
        const uris = (r.props.attachments as Array<{ uri: string; title: string }>).map((a) => [a.title, a.uri]);
        expect(uris).toEqual([['b.com', 'https://b.com'], ['A', 'https://a.com']]);
        expect(marks(input, r)).toEqual(['link:[A](https://a.com)', 'link:/link:https://b.com']);
    });

    it('works after a /link: command without being swallowed into its URL', () => {
        const input = 'Read /link:https://a.com [Doc](https://b.com)';
        const r = parseCapture(input, ctx);
        expect(r.title).toBe('Read Doc');
        const uris = (r.props.attachments as Array<{ uri: string; title: string }>).map((a) => [a.title, a.uri]);
        expect(uris).toEqual([['a.com', 'https://a.com'], ['Doc', 'https://b.com']]);
        expect(marks(input, r)).toEqual(['link:/link:https://a.com', 'link:[Doc](https://b.com)']);
        expectWellFormed(r.highlights, input.length);
    });

    it("leaves core's own /link:[label](url) syntax alone", () => {
        const input = 'x /link:[Doc](https://a.com)';
        const r = parseCapture(input, ctx);
        expect(r.title).toBe('x');
        expect(r.props.attachments).toMatchObject([{ title: 'Doc', uri: 'https://a.com' }]);
        expect(marks(input, r)).toEqual(['link:/link:[Doc](https://a.com)']);
    });

    it('maps highlight offsets after a markdown link back to the raw input', () => {
        const input = 'Read [Spec](https://example.com/a/very/long/path) @desk #docs /due:tomorrow';
        const r = parseCapture(input, ctx);
        expect(r.props).toMatchObject({ contexts: ['@desk'], tags: ['#docs'], dueDate: '2026-10-22' });
        const at = (s: string) => input.indexOf(s);
        expect(r.highlights).toEqual([
            { start: at('['), end: at(')') + 1, kind: 'link' },
            { start: at('@desk'), end: at('@desk') + 5, kind: 'context' },
            { start: at('#docs'), end: at('#docs') + 5, kind: 'tag' },
            { start: at('/due:'), end: input.length, kind: 'date' },
        ]);
    });
});

describe('extension: bare due: and review:', () => {
    it('due:tomorrow works like /due:tomorrow', () => {
        const input = 'Ship due:tomorrow';
        const r = parseCapture(input, ctx);
        expect(r.title).toBe('Ship');
        expect(r.props).toEqual({ dueDate: '2026-10-22' });
        expect(marks(input, r)).toEqual(['date:due:tomorrow']);
    });

    it('start: works bare too', () => {
        const input = 'start:tomorrow call mom';
        const r = parseCapture(input, ctx);
        expect(r.title).toBe('call mom');
        expect(r.props).toEqual({ startTime: '2026-10-22' });
        expect(marks(input, r)).toEqual(['date:start:tomorrow']);
    });

    it.each([
        ['Ship due:2026-11-03', 'Ship', { dueDate: '2026-11-03' }],
        ['start:2026-11-03 call mom', 'call mom', { startTime: '2026-11-03' }],
        ['review:2026-11-03 read it', 'read it', { reviewAt: '2026-11-03' }],
    ])('takes the ISO date the date picker inserts: %s', (input, title, props) => {
        const r = parseCapture(input, ctx);
        expect(r.title).toBe(title);
        expect(r.props).toEqual(props);
    });

    it('overstart: is not a command', () => {
        // (core's own natural-language detection still finds "tomorrow" as a due date)
        expect(parseCapture('overstart:tomorrow', ctx).props.startTime).toBeUndefined();
    });

    it('review:next friday takes a natural-language value', () => {
        const input = 'Plan review:next friday';
        const r = parseCapture(input, ctx);
        expect(r.title).toBe('Plan');
        expect(r.props).toEqual({ reviewAt: '2026-10-30' });
        expect(marks(input, r)).toEqual(['date:review:next friday']);
    });

    it('works at the start of the input when followed by a control token', () => {
        // (+Project works as the stop because core parses it after dates;
        // @context doesn't, because core strips contexts before dates.)
        const input = 'due:tomorrow +Proj Ship';
        const r = parseCapture(input, ctx);
        expect(r.title).toBe('Ship');
        expect(r.props).toEqual({ projectId: 'p1', dueDate: '2026-10-22' });
        expect(marks(input, r)).toEqual(['date:due:tomorrow', 'project:+Proj']);
    });

    it.each([
        ['due:friday call mom', 'call mom', { dueDate: '2026-10-23' }, 'date:due:friday'],
        ['/due:tomorrow Ship it', 'Ship it', { dueDate: '2026-10-22' }, 'date:/due:tomorrow'],
        ['review:next monday read the book', 'read the book', { reviewAt: '2026-10-26' }, 'date:review:next monday'],
        ['due:next friday call mom', 'call mom', { dueDate: '2026-10-30' }, 'date:due:next friday'],
        ['Call /start:tomorrow mom later @x', 'Call mom later', { startTime: '2026-10-22', contexts: ['@x'] }, 'date:/start:tomorrow'],
    ])('date first: %s', (input, title, props, dateMark) => {
        const r = parseCapture(input, ctx);
        expect(r.title).toBe(title);
        expect(r.props).toEqual(props);
        expect(r.warnings).toEqual([]);
        expect(marks(input, r).filter((m) => m.startsWith('date:'))).toEqual([dateMark]);
        expectWellFormed(r.highlights, input.length);
    });

    it('a genuinely invalid bare value stays plain text', () => {
        const r = parseCapture('due:blorp x', ctx);
        expect(r.title).toBe('due:blorp x');
        expect(r.props).toEqual({});
        expect(r.warnings).toEqual([]);
        expect(r.highlights).toEqual([]);
    });

    it('a genuinely invalid /due: keeps its warning', () => {
        const r = parseCapture('/due:blorp', ctx);
        expect(r.warnings).toEqual(['Invalid date: /due:blorp']);
        expect(r.props).toEqual({});
    });

    it('does not match overdue:', () => {
        const input = 'Pay overdue:invoice';
        const r = parseCapture(input, ctx);
        expect(r.title).toBe('Pay overdue:invoice');
        expect(r.props).toEqual({});
        expect(r.highlights).toEqual([]);
    });

    it('does not match due: inside a URL', () => {
        const input = 'see https://x.com/due:abc';
        const r = parseCapture(input, ctx);
        expect(r.title).toBe(input);
        expect(r.props).toEqual({});
        expect(r.highlights).toEqual([]);
    });

    it('stays plain text when the value is not a date', () => {
        const input = 'Check due:diligence';
        const r = parseCapture(input, ctx);
        expect(r.title).toBe('Check due:diligence');
        expect(r.props).toEqual({});
        expect(r.warnings).toEqual([]);
        expect(r.highlights).toEqual([]);
    });

    it('defers to an explicit /due: in the same line', () => {
        const input = 'x due:friday /due:tomorrow';
        const r = parseCapture(input, ctx);
        expect(r.props.dueDate).toBe('2026-10-22');
        expect(marks(input, r)).toEqual(['date:/due:tomorrow']);
    });
});

describe('defaults', () => {
    it('applies the default area and focus when the line sets neither', () => {
        const r = parseCapture('Call mom', ctx, { areaId: 'a2', isFocusedToday: true });
        expect(r.props).toEqual({ areaId: 'a2', isFocusedToday: true });
    });

    it('a !Area in the line wins over the default area', () => {
        const r = parseCapture('Call mom !Work', ctx, { areaId: 'a2' });
        expect(r.props).toEqual({ areaId: 'a1' });
    });

    it('a +Project in the line suppresses the default area', () => {
        const r = parseCapture('Call mom +Proj', ctx, { areaId: 'a2' });
        expect(r.props).toEqual({ projectId: 'p1' });
    });

    it('/* in the line sets focus even when the default is off', () => {
        const r = parseCapture('Call mom /*', ctx, { isFocusedToday: false });
        expect(r.props).toEqual({ isFocusedToday: true, status: 'next' });
    });

    it('never sends a status the line did not set', () => {
        expect(parseCapture('Call mom', ctx).props).toEqual({});
    });
});

describe('parseBulk', () => {
    it('strips list markers, skips blank lines and offsets highlights per line', () => {
        const text = [
            '- Buy milk @shop',
            '',
            '* [ ] Call mom !1',
            '   ',
            '1. Pay rent /due:tomorrow',
            '2) • odd',
            '- [ ] Read [Doc](https://a.com)',
            '[ ] Plain',
            '• Bullet #t',
        ].join('\r\n');
        const rows = parseBulk(text, ctx);
        expect(rows.map((r) => r.title)).toEqual([
            'Buy milk', 'Call mom', 'Pay rent', '• odd', 'Read Doc', 'Plain', 'Bullet',
        ]);
        expect(rows.map((r) => r.line)).toEqual([0, 2, 4, 5, 6, 7, 8]);
        for (const row of rows) {
            expect(text.slice(row.lineStart, row.lineStart + row.raw.length)).toBe(row.raw);
            expectWellFormed(row.highlights, row.raw.length);
        }
        expect(marks(rows[0].raw, rows[0])).toEqual(['context:@shop']);
        expect(marks(rows[1].raw, rows[1])).toEqual(['priority:!1']);
        expect(rows[1].props).toEqual({ priority: 'urgent' });
        expect(marks(rows[2].raw, rows[2])).toEqual(['date:/due:tomorrow']);
        expect(marks(rows[4].raw, rows[4])).toEqual(['link:[Doc](https://a.com)']);
        expect(marks(rows[6].raw, rows[6])).toEqual(['tag:#t']);
    });

    it('applies defaults to every line', () => {
        const rows = parseBulk('a\nb +Proj', ctx, { areaId: 'a1' });
        expect(rows.map((r) => r.props)).toEqual([{ areaId: 'a1' }, { projectId: 'p1' }]);
    });

    it('returns nothing for empty text', () => {
        expect(parseBulk('', ctx)).toEqual([]);
        expect(parseBulk('\n  \n- \n', ctx)).toEqual([]);
    });
});

describe('props contract', () => {
    it('only emits fields the Local API accepts', () => {
        const allowed = new Set([
            'status', 'priority', 'tags', 'contexts', 'dueDate', 'startTime', 'reviewAt', 'projectId', 'areaId',
            'description', 'assignedTo', 'energyLevel', 'timeEstimate', 'isFocusedToday', 'attachments',
        ]);
        const r = parseCapture(
            'All [L](https://l.com) @c #t +Proj %P /start:tomorrow /due:friday /review:monday /energy:high /estimate:1h /note:n /next /* !2',
            ctx,
            { areaId: 'a1', isFocusedToday: true },
        );
        for (const key of Object.keys(r.props)) expect(allowed.has(key)).toBe(true);
        expect(r.props).not.toHaveProperty('id');
        expect(r.props).not.toHaveProperty('title');
    });

    it('never produces overlapping or unsorted highlights on messy input', () => {
        const inputs = [
            '/note:call @bob later /energy:low more /next',
            'x /link:https://a.com @c [D](https://d.com) due:tomorrow !1',
            '  !1  [a](https://a.com)[b](https://b.com) #x#y @@ ++ !! %% //due:',
        ];
        for (const input of inputs) expectWellFormed(parseCapture(input, ctx).highlights, input.length);
    });
});
