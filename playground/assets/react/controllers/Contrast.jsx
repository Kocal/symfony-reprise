import React from 'react';
import { contrastRatio } from '../../demos/wcag';

const LEVELS = [['AA', 4.5], ['AAA', 7], ['AA Large', 3]];

function Badge({ label, ok }) {
    return (
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {label} {ok ? '✓' : '✗'}
        </span>
    );
}

export default function ({ foreground, background }) {
    const [fg, setFg] = React.useState(foreground);
    const [bg, setBg] = React.useState(background);
    const ratio = contrastRatio(fg, bg);

    return (
        <div className="flex flex-col gap-4">
            <p className="m-0 text-slate-500">
                <span className="text-lg">⚛️</span> Rendered by <strong>UX React</strong> — a WCAG contrast checker, computed live in the browser (initial colors from Symfony props).
            </p>
            <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm font-medium">Text
                    <input type="color" value={fg} onChange={(event) => setFg(event.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-200" />
                    <code>{fg}</code>
                </label>
                <label className="flex items-center gap-2 text-sm font-medium">Background
                    <input type="color" value={bg} onChange={(event) => setBg(event.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-200" />
                    <code>{bg}</code>
                </label>
            </div>
            <div className="flex items-center justify-center rounded-lg p-6 text-lg font-semibold" style={{ color: fg, backgroundColor: bg }}>
                The quick brown fox jumps over the lazy dog.
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <strong className="text-2xl">{ratio.toFixed(2)}:1</strong>
                {LEVELS.map(([label, min]) => <Badge key={label} label={label} ok={ratio >= min} />)}
            </div>
        </div>
    );
}
