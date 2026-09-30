<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project architecture

- Use the Google Maps JavaScript API for Satellite Map because the product requires authentic satellite imagery and familiar map controls.
- Keep freight rates, congestion, vessel counts, and ETAs labeled as demo data until a live source is connected.
- Shared Active Requirement lives in src/lib/requirement.ts; only Voyage & Charter edits it, other tabs read it — avoids duplicate pickers.
- All data labels use DataBadge (live / historical / configured / simulated) — a label must never claim more than the data deserves.
