import fs from 'fs';
import path from 'path';

const forbiddenImports = [
    '@/modules/payments',
    '@/modules/channels',
    '@/modules/identity',
    '@/prisma',
];

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

describe('Telegram handlers import boundaries', () => {
    it('does not import domain services directly', () => {
        const root = path.join(process.cwd(), 'src', 'modules', 'telegram', 'handlers');
        const files = collectFiles(root);

        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            for (const forbidden of forbiddenImports) {
                expect(content.includes(forbidden)).toBe(false);
            }
        }
    });
});
