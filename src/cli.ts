#!/usr/bin/env node
import { Command } from 'commander';
import { runFix } from './index.js';

declare const process: {
  argv: string[];
  stdout: { write(data: string): void };
  stderr: { write(data: string): void };
  exitCode?: number;
};

const program = new Command();

program
  .name('haq')
  .description('Fast, deterministic, failure-first PR triage CLI')
  .version('0.1.0');

program
  .command('fix')
  .description('Compile a failure-first triage brief for a GitHub PR')
  .argument('[pr]', 'PR number or full GitHub PR URL (auto-detects current branch if omitted)')
  .option('--budget <number>', 'Max token cap using o200k_base', '1000')
  .option('--full', 'Disable truncation when unresolved review threads overflow budget', false)
  .option('--json', 'Output structured JSON instead of Markdown', false)
  .action(async (pr: string | undefined, opts: { budget: string; full: boolean; json: boolean }) => {
    const budget = Number.parseInt(opts.budget, 10);
    if (!Number.isFinite(budget) || budget < 50) {
      process.stderr.write('Error: --budget must be an integer >= 50.\n');
      process.exitCode = 1;
      return;
    }

    try {
      const output = await runFix({
        pr,
        budget,
        full: Boolean(opts.full),
        json: Boolean(opts.json),
      });
      process.stdout.write(output + '\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);