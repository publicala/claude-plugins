# Acme Books

Acme Books is an online bookstore for independent publishers. It sells ebooks and audiobooks and pays publishers monthly.

## Stack

Laravel 12, PHP 8.4, Livewire 4, Tailwind 4, Vite, MySQL 8, Redis and Horizon. `composer.json` and `package.json` hold the versions.

## Commands

- `composer dev` starts the server, queue, logs and Vite.
- `composer test` is the full gate: Pest, Pint, PHPStan level 8.
- `./vendor/bin/pest tests/Feature/SomeTest.php` runs one test file.

## Hard constraints

These break production when ignored.

- **Prices are integers in cents.** Never store or compare a price as a float.
- **Payouts run once per month.** `PayoutRun` locks the month before it writes, so a second run for the same month is a no-op.
- Never run `php artisan migrate:fresh` against a shared database.

## Conventions

- Every PHP class has `declare(strict_types=1)` and is `final`.
- Pages are class-based Livewire components in `app/Livewire`, with views in `resources/views/livewire`.
- Money goes through `App\Support\Money`, never through `number_format()`.
- Import jobs (`ImportOnixFeed`, `ImportCoverImages`, `ImportPriceList`) run on the `imports` queue.
- Tests use the `Acme\Testing\Factories` factories and never call `DB::table()` directly.

## Read when the task needs it

- `docs/payouts.md` explains the monthly payout run, the lock, the retry rules and the CSV the finance team downloads.
- `docs/search.md`: Meilisearch setup.
