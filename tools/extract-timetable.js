#!/usr/bin/env node
// 鳴門線の時刻表PDF（平日・土日祝）から時刻を取り出し、index.html の RAW_TIMETABLE を書き換える。
// 使い方は tools/README.md を参照。
//
//   node tools/extract-timetable.js [平日PDF] [土日祝PDF]
//   （省略時は pdf/a1_naruto_weekday.pdf と pdf/a2_naruto_weekend.pdf）
//
// 必要なもの: Node.js 18以上、poppler の pdftotext（-bbox オプションが使えるもの）
//   pdftotext の場所は環境変数 PDFTOTEXT で指定できる。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const STOP_COUNT = 15;           // 片方向の停留所数（index.html の STOPS と同じ）
const MARK_RE = /^[※◎◆□●]$/;
const TIME_RE = /^(\(?)(\d{1,2}):(\d{2})$/;

const pdftotext = process.env.PDFTOTEXT || 'pdftotext';

function readWords(pdfPath) {
    let html;
    try {
        html = execFileSync(pdftotext, ['-bbox', pdfPath, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
        throw new Error(`pdftotext を実行できません（${pdftotext}）。poppler の pdftotext を入れるか、環境変数 PDFTOTEXT で場所を指定してください。\n${e.message}`);
    }
    if (!html.includes('<word')) throw new Error(`${pdfPath}: 単語の座標が取れません。xpdf 版ではなく poppler 版の pdftotext が必要です。`);
    const re = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;
    const words = [];
    let m;
    while ((m = re.exec(html))) words.push({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: m[5] });
    return words;
}

// 近い値どうしをまとめる（gap 以内なら同じ列）
function cluster(values, gap) {
    const sorted = [...values].sort((a, b) => a - b);
    const groups = [];
    for (const v of sorted) {
        const g = groups[groups.length - 1];
        if (g && v - g.max <= gap) { g.max = v; g.items.push(v); }
        else groups.push({ min: v, max: v, items: [v] });
    }
    return groups.map(g => ({ center: g.items.reduce((s, v) => s + v, 0) / g.items.length, count: g.items.length }));
}

function parsePdf(pdfPath) {
    const words = readWords(pdfPath);
    const errors = [];

    // 時刻は右寄せなので、右端(xMax)の位置で列を判定する
    const timeCols = cluster(words.filter(w => TIME_RE.test(w.t)).map(w => w.x1), 4).map(c => c.center);
    if (timeCols.length !== STOP_COUNT * 2) {
        throw new Error(`${pdfPath}: 時刻の列が ${timeCols.length} 列見つかりました（想定は ${STOP_COUNT * 2} 列）。表の形が変わった可能性があります。`);
    }
    // 行先番号の列（左右の表の左端）
    const noCols = cluster(words.filter(w => /^\d{1,2}$/.test(w.t)).map(w => w.x0), 4)
        .filter(c => c.count >= 5).map(c => c.center);
    if (noCols.length !== 2) throw new Error(`${pdfPath}: 行先番号の列が ${noCols.length} 列見つかりました（想定は 2 列）。`);

    const halves = [
        { dir: 'down', noX: noCols[0], cols: timeCols.slice(0, STOP_COUNT) },
        { dir: 'up', noX: noCols[1], cols: timeCols.slice(STOP_COUNT) }
    ];
    const result = { down: [], up: [] };

    for (const { dir, noX, cols } of halves) {
        const lo = cols[0] - 30, hi = cols[cols.length - 1] + 5;
        const rowHeads = words.filter(w => /^\d{1,2}$/.test(w.t) && Math.abs(w.x0 - noX) < 4).sort((a, b) => a.y0 - b.y0);
        for (const head of rowHeads) {
            const yc = (head.y0 + head.y1) / 2;
            const rowWords = words.filter(w => Math.abs((w.y0 + w.y1) / 2 - yc) < 3.2 && w.x1 > lo && w.x1 < hi + 2);
            const times = Array(STOP_COUNT).fill(null);
            let mark = '';
            for (const w of rowWords) {
                if (MARK_RE.test(w.t)) { mark = mark || w.t; continue; }
                const m = w.t.match(TIME_RE);
                if (!m) continue;
                if (m[1]) continue; // 「(19:42 高島止)」のような途中止まりの注記は、その停留所には行かないので除外
                let best = -1, bestDist = Infinity;
                cols.forEach((x, i) => { const d = Math.abs(w.x1 - x); if (d < bestDist) { bestDist = d; best = i; } });
                if (bestDist > 4) { errors.push(`${dir} 行先${head.t} y=${yc.toFixed(0)}: 「${w.t}」がどの列か判定できません`); continue; }
                if (times[best]) errors.push(`${dir} 行先${head.t} y=${yc.toFixed(0)}: 同じ列に時刻が2つあります`);
                times[best] = `${Number(m[2])}:${m[3]}`;
            }
            // 時刻が左から右へ増えているか確認（PDF上はどちらの方向も進行順に並んでいる）
            let prev = -1;
            for (const t of times) {
                if (!t) continue;
                const [h, mi] = t.split(':').map(Number);
                if (h * 60 + mi < prev) { errors.push(`${dir} 行先${head.t}: 時刻の並びがおかしい ${times.join(',')}`); break; }
                prev = h * 60 + mi;
            }
            if (times.filter(Boolean).length < 2) errors.push(`${dir} 行先${head.t} y=${yc.toFixed(0)}: 時刻が2つ未満です`);
            // 上りは PDF 上で停留所が逆順なので、STOPS（下り順）にそろえる
            result[dir].push({ no: head.t, mark, times: dir === 'up' ? times.reverse() : times });
        }
    }
    if (errors.length) throw new Error(`${pdfPath}:\n  ` + errors.join('\n  '));
    return result;
}

function formatBlock(data) {
    const days = ['weekday', 'weekend'].map(day => {
        const dirs = ['down', 'up'].map(dir => {
            const rows = data[day][dir].map(r => JSON.stringify(`${r.no}|${r.mark}|${r.times.map(t => t || '').join(',')}`));
            return `              ${dir}: [\n                ${rows.join(',\n                ')}\n              ],`;
        });
        return `            ${day}: {\n${dirs.join('\n')}\n            }`;
    });
    return `        const RAW_TIMETABLE = {\n${days.join(',\n')}\n        };`;
}

function main() {
    const weekdayPdf = process.argv[2] || path.join(ROOT, 'pdf', 'a1_naruto_weekday.pdf');
    const weekendPdf = process.argv[3] || path.join(ROOT, 'pdf', 'a2_naruto_weekend.pdf');
    const data = { weekday: parsePdf(weekdayPdf), weekend: parsePdf(weekendPdf) };

    const html = fs.readFileSync(INDEX, 'utf8');
    const eol = html.includes('\r\n') ? '\r\n' : '\n';
    const re = /(\/\/ @@TIMETABLE_START\r?\n)[\s\S]*?(\r?\n\s*\/\/ @@TIMETABLE_END)/;
    if (!re.test(html)) throw new Error('index.html に @@TIMETABLE_START / @@TIMETABLE_END の目印が見つかりません。');
    const block = formatBlock(data).replace(/\n/g, eol);
    const updated = html.replace(re, (_, start, end) => start + block + end);

    for (const day of ['weekday', 'weekend']) {
        console.log(`${day === 'weekday' ? '平日  ' : '土日祝'}: 下り ${data[day].down.length} 便 / 上り ${data[day].up.length} 便`);
    }
    if (updated === html) {
        console.log('index.html の時刻データに変更はありません。');
    } else {
        fs.writeFileSync(INDEX, updated);
        console.log('index.html の時刻データを更新しました。git diff で変更内容を確認してください。');
    }
}

try {
    main();
} catch (e) {
    console.error('エラー: ' + e.message);
    process.exit(1);
}
