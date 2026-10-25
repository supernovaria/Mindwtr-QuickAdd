import type { ReactNode } from 'react';

// Mindwtr's own help string (core i18n en.ts, 'quickAdd.help'), plus the
// QuickAdd parser's extensions. Styled like Mindwtr's QuickAddSyntaxHint:
// typable tokens stand out, <placeholders> recede.
export const QUICK_ADD_HELP =
  'Quick add supports /start:<when>, /due:<when>, /review:<when>, /estimate:45m, /note:<text>, /link:<url>, /energy:<level>, /priority:<level>, /next, /* focus, /area:<name> or !Area, @context, #tag, +Project, %Person (or %"Full Name"). Due dates stay date-only unless you include a time.';

export const QUICK_ADD_EXTRAS =
  'Also: !1 !2 !3 !4 for urgent/high/medium/low priority, start:/due:/review:<when> without the slash (td = today, tmrw = tomorrow), and [label](https://…) links.';

export const QUICK_ADD_EXAMPLE = 'e.g. Call mom /due:tomorrow @phone';

const HINT_SEGMENT = /((?:<[^>]+>)|(?:%"[^"]*")|(?:\[label\]\([^)]*\))|(?:[/@#+%!][^\s,()<.]+)|(?:\b(?:due|review):))/g;

function Hint({ text }: { text: string }) {
  return (
    <>
      {text.split(HINT_SEGMENT).map((part, index): ReactNode => {
        if (!part) return null;
        if (part.startsWith('<') && part.endsWith('>')) {
          return <span key={index} className="hint-placeholder">{part}</span>;
        }
        if (/^([/@#+%![]|due:|review:)/.test(part)) {
          return <span key={index} className="hint-token">{part}</span>;
        }
        return part;
      })}
    </>
  );
}

export function SyntaxHelpContent() {
  return (
    <div className="syntax-help-body">
      <p><Hint text={QUICK_ADD_HELP} /></p>
      <p><Hint text={QUICK_ADD_EXTRAS} /></p>
    </div>
  );
}
