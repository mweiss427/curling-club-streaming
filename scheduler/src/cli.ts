import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { listUpcoming } from './google/list.js';

async function main(): Promise<void> {
    const argv = await yargs(hideBin(process.argv))
        .command('list', 'List upcoming events for all configured sheets', (y) =>
            y.option('max', { type: 'number', default: 10 })
                .option('days', { type: 'number', default: 7 })
        )
        .demandCommand(1)
        .help()
        .parse();

    const [cmd] = argv._;
    if (cmd === 'list') {
        const results = await listUpcoming({ days: Number(argv.days), max: Number(argv.max) });
        for (const r of results) {
            console.log(`[Sheet ${r.sheet}] ${r.start} → ${r.end}  ${r.summary ?? ''}`.trim());
        }
        return;
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});


