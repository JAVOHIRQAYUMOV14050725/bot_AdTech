import fs from 'fs';
import path from 'path';

const forbiddenPatterns = ['ctx.reply(', 'ctx.answerCbQuery(', 'ctx.editMessageText('];
const allowlist = new Set([
    path.join(process.cwd(), 'src', 'modules', 'telegram', 'telegram-safe-text.util.ts'),
]);

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

describe('Telegram handlers use replySafe wrappers', () => {
    it('does not call ctx.reply/answerCbQuery/editMessageText directly', () => {
        const root = path.join(process.cwd(), 'src', 'modules', 'telegram');
        const files = collectFiles(root);

        for (const file of files) {
            if (allowlist.has(file)) {
                continue;
            }
            const content = fs.readFileSync(file, 'utf8');
            for (const pattern of forbiddenPatterns) {
                expect(content.includes(pattern)).toBe(false);
            }
        }
    });
});
