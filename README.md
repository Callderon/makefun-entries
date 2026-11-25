# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Callderon/makefun-entries/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Callderon/makefun-entries/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Which pre-token protocol is worth farming next? Token Radar reads a sealed snapshot of
every protocol, ranks the ones that record no token by what their launch would be worth,
and shows how to farm each one — in a dashboard you can sort, filter and open per
protocol.

## The model (radar-2)

```
implied = TVL x peer_multiple(category)
  x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
  x (0.6 + min(age_days, 1095) / 1095 x 0.4)
  x (1 + min(chains - 1, 4) x 0.02)
```

The peer multiple is the median market-cap-to-TVL ratio of the token-bearing protocols in
the same category (at least three peers, else the snapshot-wide median), clamped to
[0.05, 1.5]. No protocol name is ever special-cased. The board ranks 198 protocols — every
one the snapshot's watchlist rule keeps, including all 40 on the watchlist — and sets aside
144 pre-token protocols that are products of a token that already trades (exchanges,
bridges, liquid-staking and wrapped products). Live-token protocols are shown apart, at the
market's own values, in the dashboard's Live view.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the snapshot, writes the ranked board to
`out/board.json`, the dashboard's data to `out/data.js`, copies `dashboard/` and
`screenshots/` to `out/`, and writes `out/dossier.json` with the vendored make.fun library.
The run is deterministic: the same snapshot always writes the same bytes.

## Layout

- `main.ts` — the entrypoint: read the snapshot, score it, write the outputs.
- `lib/model.ts` — the model: peer multiples, implied value, farm plans, the board.
- `vendor/makefun-board.ts` — make.fun's dossier library, byte for byte as the kit ships it.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js`. No network, no framework.
- `screenshots/` — the board, a protocol's detail view and a filtered view, as rendered.

---

<sub>Entered on [make.fun](https://make.fun/?ref=s75hcstx&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
