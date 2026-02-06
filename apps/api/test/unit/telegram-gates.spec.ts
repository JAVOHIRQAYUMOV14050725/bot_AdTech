import fs from 'fs';
import path from 'path';

function collectFiles(dir: string, acc: string[] = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectFiles(fullPath, acc);
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            acc.push(fullPath);
        }
    }
    return acc;
}

describe('Telegram safety gates', () => {
    it('GATE-A: forbids direct ctx.reply/editMessageText/answerCbQuery outside safe wrapper', () => {
        const root = path.join(process.cwd(), 'src');
        const files = collectFiles(root);
        const allowed = new Set([
            path.join(root, 'modules', 'telegram', 'telegram-safe-text.util.ts'),
        ]);

        const forbiddenPatterns = [
            /ctx\.reply\(/g,
            /ctx\.editMessageText\(/g,
            /ctx\.answerCbQuery\(/g,
        ];

        const violations: string[] = [];

        for (const file of files) {
            if (allowed.has(file)) {
                continue;
            }
            const content = fs.readFileSync(file, 'utf8');
            for (const pattern of forbiddenPatterns) {
                if (pattern.test(content)) {
                    violations.push(`${file} matched ${pattern}`);
                }
            }
        }

        expect(violations).toEqual([]);
    });

    it('GATE-B: enforces a single /start entrypoint', () => {
        const root = path.join(process.cwd(), 'src');
        const files = collectFiles(root);
        let startHandlers = 0;

        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            const decoratorMatches = content.match(/@Start\(/g) ?? [];
            const botStartMatches = content.match(/\b(?:this\.)?bot\.start\(/g) ?? [];
            startHandlers += decoratorMatches.length + botStartMatches.length;
        }

        expect(startHandlers).toBe(1);
    });

    it('GATE-C: enforces answerCbQuerySafe in @Action handlers', () => {
        const root = path.join(process.cwd(), 'src', 'modules', 'telegram', 'handlers');
        const files = collectFiles(root);

        const violations: string[] = [];

        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            const actionCount = (content.match(/@Action\(/g) ?? []).length;
            if (!actionCount) {
                continue;
            }
            const ackCount = (content.match(/answerCbQuerySafe\(/g) ?? []).length;
            const ackNowCount = (content.match(/ackNow\(/g) ?? []).length;
            if (ackCount + ackNowCount < actionCount) {
                violations.push(`${file} missing answerCbQuerySafe/ackNow for @Action handlers`);
            }
        }

        expect(violations).toEqual([]);
    });
});
