<?php

declare(strict_types=1);

/**
 * Coverage floor gate (REQUIREMENTS §4: coverage tracked and not allowed to
 * regress). Reads a Clover report and fails if line coverage drops below a floor.
 *
 * Freshen\Driver\Redis is excluded from the denominator: it has no unit coverage
 * by design (no ext-redis in the unit lane) and is covered by the separate live
 * Redis integration lane (scripts/php-redis-it.sh). Counting its lines here would
 * make the unit gate meaningless.
 *
 * Usage (runs inside the CI/Docker PHP container — never on the host):
 *   php scripts/php-coverage-gate.php <clover.xml> <floorPercent> [excludeSubstring]
 * Exit 0 if coverage >= floor, 1 otherwise (or on bad input).
 */

$clover  = $argv[1] ?? '';
$floor   = isset($argv[2]) ? (float) $argv[2] : 0.0;
$exclude = $argv[3] ?? 'src/Driver/';

if ($clover === '' || !is_file($clover)) {
    fwrite(STDERR, "coverage-gate: clover report not found: '{$clover}'\n");
    exit(1);
}

$xml = simplexml_load_file($clover);
if ($xml === false) {
    fwrite(STDERR, "coverage-gate: could not parse clover XML: '{$clover}'\n");
    exit(1);
}

$total = 0;
$covered = 0;

// Sum per-file line metrics for every file except the excluded path fragment.
foreach ($xml->xpath('//file') as $file) {
    $name = (string) ($file['name'] ?? '');
    if ($exclude !== '' && str_contains($name, $exclude)) {
        continue;
    }
    $metrics = $file->metrics;
    if (!$metrics instanceof SimpleXMLElement) {
        continue;
    }
    $total   += (int) $metrics['statements'];
    $covered += (int) $metrics['coveredstatements'];
}

if ($total === 0) {
    fwrite(STDERR, "coverage-gate: no measurable lines found (excluding '{$exclude}')\n");
    exit(1);
}

$pct = $covered / $total * 100;
$pctStr = number_format($pct, 2);
$floorStr = number_format($floor, 2);

printf(
    "coverage-gate: %s%% line coverage (%d/%d) excluding '%s' — floor %s%%\n",
    $pctStr,
    $covered,
    $total,
    $exclude,
    $floorStr,
);

if ($pct + 1e-9 < $floor) {
    fwrite(STDERR, "coverage-gate: FAIL — {$pctStr}% is below the {$floorStr}% floor.\n");
    exit(1);
}

echo "coverage-gate: PASS\n";
exit(0);
